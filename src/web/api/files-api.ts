import { SYSTEM_PRINCIPAL, type Principal } from "../../auth/principal.js";
import { assertFileVisible, scopedWhere } from "./scope.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import { buildContentDisposition, describeFileDownload } from "./file-download.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import { contactAvatarUrl } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Tệp: danh sách tệp / ảnh / video đã thấy trong các cuộc trò chuyện, tải về, tải lại vào kho.

export const FILE_LIST_SPEC: ListSpec = {
  fields: {
    group_id: { sql: "a.group_id", type: "number" },
    status: { sql: "a.status", type: "number" },
    thread_type: { sql: "g.thread_type", type: "number" },
    sender_uid: { sql: "m.sender_uid", type: "text" },
    sender_name: { sql: "m.sender_name", type: "text" },
    file_name: { sql: "a.file_name", type: "text" },
    file_ext: { sql: "a.file_ext", type: "text" },
    size: { sql: "COALESCE(a.stored_bytes, a.declared_size, 0)", type: "number" },
    sent_at: { sql: "m.sent_at", type: "date" },
    // Đã bóc chữ chưa (bot đọc hoặc quản trị bấm Đọc)
    has_text: {
      type: "boolean",
      build: (_operator, values) => ({ sql: values[0] === "1" || values[0] === "true" ? "t.text IS NOT NULL" : "t.text IS NULL", params: [] }),
    },
  },
  sorts: {
    sent_at: "m.sent_at",
    file_name: "a.file_name",
    size: "COALESCE(a.stored_bytes, a.declared_size, 0)",
    status: "a.status",
  },
  defaultSort: { by: "sent_at", dir: "desc" },
  tieBreaker: "a.id",
  // Tìm cả trong chữ đã bóc — tệp bot từng đọc thì tìm được theo nội dung
  search: { param: "q", columns: ["a.file_name", "m.sender_name", "t.text"] },
};

const FILE_FROM = `FROM attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
  LEFT JOIN contact sc ON sc.zalo_uid = m.sender_uid LEFT JOIN attachment_text t ON t.attachment_id = a.id`;
const FILE_COLUMNS = `
  a.id, a.file_name, a.file_ext, a.status, a.keep_file, a.stored_bytes, a.declared_size, a.last_error, a.attempts, a.stored_at,
  m.id AS message_id, m.sent_at, m.sender_name, m.sender_uid, m.zalo_msg_type, m.kind AS message_kind, sc.avatar_key AS sender_avatar_key,
  sc.id AS sender_contact_id, g.id AS thread_id, g.thread_type, t.method AS text_method, t.char_count AS text_chars, t.summary AS text_summary, t.extracted_at AS text_extracted_at,
  IF(g.thread_type = ${ConversationType.Direct}, CONCAT('Nhắn riêng · ', g.name), COALESCE(NULLIF(g.label, ''), g.name)) AS thread_name`;

export function decorateFile(row: RowDataPacket): Record<string, unknown> {
  const { sender_avatar_key: avatarKey, ...rest } = row;
  return {
    ...rest,
    sender_avatar_url: contactAvatarUrl(row.sender_uid, avatarKey),
    size: Number(row.stored_bytes ?? row.declared_size ?? 0),
    download_url: row.status === AttachmentStatus.Stored ? `/api/files/${row.id}/download` : null,
    can_retry: row.status === AttachmentStatus.Failed || row.status === AttachmentStatus.Skipped,
    text_chars: row.text_chars === null || row.text_chars === undefined ? null : Number(row.text_chars),
    keep_file: Boolean(row.keep_file),
  };
}

export function listFiles(db: Db, params: URLSearchParams, principal: Principal = SYSTEM_PRINCIPAL) {
  return runList(db, params, FILE_LIST_SPEC, {
    select: FILE_COLUMNS, from: FILE_FROM, baseWhere: scopedWhere(principal, undefined, "a.group_id"), decorate: (rows) => rows.map(decorateFile),
  });
}

export async function getFile(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${FILE_COLUMNS} ${FILE_FROM} WHERE a.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có tệp này");
  return decorateFile(rows[0]);
}

export const fileRoutes: ApiRoute[] = [
  // Chữ đã bóc của tệp — màn Tệp xem; chưa có thì 404 để giao diện mời bấm «Đọc»
  ["GET", /^\/api\/files\/(\d+)\/text$/, async ({ principal, response, match, service }) => {
    await assertFileVisible(service.db, principal, parseId(match[1]));
    const [rows] = await service.db.query<RowDataPacket[]>(
      "SELECT method, char_count, summary, text, extracted_at FROM attachment_text WHERE attachment_id = ?", [parseId(match[1])]);
    if (!rows[0] || rows[0].text === null) throw new ApiError(404, "not_found", "Tệp này chưa được đọc");
    sendOk(response, rows[0]);
  }],
  // Bóc chữ ngay (quản trị bấm «Đọc» ở màn Tệp) — cùng bộ đọc với bot, kết quả cất chung
  ["POST", /^\/api\/files\/(\d+)\/extract$/, async ({ principal, response, match, service }) => {
    await assertFileVisible(service.db, principal, parseId(match[1]));
    const id = parseId(match[1]);
    if (!service.assistant) throw new ApiError(409, "assistant_off", "Trợ lý AI đang tắt — chưa có GEMINI_API_KEY");
    const result = await service.assistant.readFile(id);
    if ("error" in result) throw new ApiError(422, "cannot_read", result.error);
    await recordAudit(service.db, { entity: "file", entityId: id, action: "extract", message: `Đọc chữ (${result.summary}, ${result.charCount} ký tự)` });
    sendOk(response, await getFile(service.db, id), result.cached ? `Đã có chữ của tệp (${result.charCount} ký tự)` : `Đã đọc: ${result.summary}, ${result.charCount} ký tự`);
  }],
  ["GET", /^\/api\/files$/, async ({ response, url, service, principal }) => sendOk(response, await listFiles(service.db, url.searchParams, principal))],
  ["GET", /^\/api\/files\/(\d+)$/, async ({ principal, response, match, service }) => {
    await assertFileVisible(service.db, principal, parseId(match[1]));
    sendOk(response, await getFile(service.db, parseId(match[1])));
  }],
  // ?inline=1 → ảnh hiện thẳng trong khung chat (đúng Content-Type ảnh; máy chủ bật nosniff nên octet-stream sẽ không vẽ được)
  ["GET", /^\/api\/files\/(\d+)\/download$/, async ({ principal, response, match, url, service }) => {
    await assertFileVisible(service.db, principal, parseId(match[1]));
    const id = parseId(match[1]);
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT a.storage_key, a.file_name, a.file_ext, m.kind AS message_kind
       FROM attachment a LEFT JOIN message m ON m.id = a.message_id WHERE a.id = ? AND a.status = ?`, [id, AttachmentStatus.Stored]);
    const row = rows[0];
    const key = row?.storage_key as string | undefined;
    if (!row || !key) throw new ApiError(404, "not_found", "Tệp chưa có trong kho");
    const stream = await service.storage.read(key);
    // Tên + kiểu suy từ tên gốc / đuôi / loại tin (ảnh chat.photo không có tên) — xem file-download.ts
    const { fileName, imageType } = describeFileDownload({
      id, fileName: row.file_name as string | null, fileExt: row.file_ext as string | null, messageKind: row.message_kind as number | null, storageKey: key,
    });
    const inline = url.searchParams.get("inline") === "1" && Boolean(imageType);
    response.writeHead(200, {
      "Content-Type": imageType ?? "application/octet-stream",
      "Cache-Control": inline ? "private, max-age=3600" : "no-store",
      "Content-Disposition": buildContentDisposition(fileName, inline),
    });
    stream.pipe(response);
  }],
  // Đánh dấu «giữ tệp gốc»: không xóa khi hết hạn giữ tệp của nhóm (IDA câu 20) — vẫn theo hạn của tin
  ["PATCH", /^\/api\/files\/(\d+)$/, async ({ principal, request, response, match, service }) => {
    await assertFileVisible(service.db, principal, parseId(match[1]));
    const id = parseId(match[1]);
    const body = await readJson(request);
    if (typeof body.keep_file !== "boolean") throw new ApiError(422, "validation_error", "keep_file chỉ nhận bật / tắt");
    const before = await getFile(service.db, id);
    await service.db.query("UPDATE attachment SET keep_file = ? WHERE id = ?", [body.keep_file ? 1 : 0, id]);
    if (Boolean(before.keep_file) !== body.keep_file) {
      await recordAudit(service.db, { entity: "file", entityId: id, action: "update", message: body.keep_file ? "Đánh dấu giữ tệp gốc" : "Bỏ đánh dấu giữ tệp gốc" });
    }
    sendOk(response, await getFile(service.db, id), body.keep_file ? "Tệp gốc sẽ được giữ, không xóa khi hết hạn" : "Đã bỏ giữ — tệp gốc xóa theo hạn của nhóm");
  }],
  ["POST", /^\/api\/files\/(\d+)\/retry$/, async ({ principal, response, match, service }) => {
    await assertFileVisible(service.db, principal, parseId(match[1]));
    const id = parseId(match[1]);
    const [result] = await service.db.query<ResultSetHeader>(
      "UPDATE attachment SET status = ?, attempts = 0, last_error = '' WHERE id = ? AND status IN (?, ?)",
      [AttachmentStatus.Pending, id, AttachmentStatus.Failed, AttachmentStatus.Skipped]);
    if (!result.affectedRows) throw new ApiError(409, "not_retryable", "Tệp này đang tải hoặc đã có trong kho");
    service.downloader.enqueue(id);
    await recordAudit(service.db, { entity: "file", entityId: id, action: "retry", message: "Đưa lại vào hàng tải" });
    sendOk(response, await getFile(service.db, id), "Đã đưa tệp vào hàng tải về kho");
  }],
];
