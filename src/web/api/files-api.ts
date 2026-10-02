import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { ApiError, parseId, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import { contactAvatarUrl } from "./contacts-api.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// API Tệp: danh sách tệp / ảnh / video đã thấy trong các cuộc trò chuyện, tải về, tải lại vào kho.

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

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
  a.id, a.file_name, a.file_ext, a.status, a.stored_bytes, a.declared_size, a.last_error, a.attempts, a.stored_at,
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
  };
}

export function listFiles(db: Db, params: URLSearchParams) {
  return runList(db, params, FILE_LIST_SPEC, { select: FILE_COLUMNS, from: FILE_FROM, decorate: (rows) => rows.map(decorateFile) });
}

export async function getFile(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${FILE_COLUMNS} ${FILE_FROM} WHERE a.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có tệp này");
  return decorateFile(rows[0]);
}

export const fileRoutes: ApiRoute[] = [
  // Chữ đã bóc của tệp — màn Tệp xem; chưa có thì 404 để giao diện mời bấm «Đọc»
  ["GET", /^\/api\/files\/(\d+)\/text$/, async ({ response, match, service }) => {
    const [rows] = await service.db.query<RowDataPacket[]>(
      "SELECT method, char_count, summary, text, extracted_at FROM attachment_text WHERE attachment_id = ?", [parseId(match[1])]);
    if (!rows[0] || rows[0].text === null) throw new ApiError(404, "not_found", "Tệp này chưa được đọc");
    sendOk(response, rows[0]);
  }],
  // Bóc chữ ngay (quản trị bấm «Đọc» ở màn Tệp) — cùng bộ đọc với bot, kết quả cất chung
  ["POST", /^\/api\/files\/(\d+)\/extract$/, async ({ response, match, service }) => {
    const id = parseId(match[1]);
    if (!service.assistant) throw new ApiError(409, "assistant_off", "Trợ lý AI đang tắt — chưa có GEMINI_API_KEY");
    const result = await service.assistant.readFile(id);
    if ("error" in result) throw new ApiError(422, "cannot_read", result.error);
    await recordAudit(service.db, { entity: "file", entityId: id, action: "extract", message: `Đọc chữ (${result.summary}, ${result.charCount} ký tự)` });
    sendOk(response, await getFile(service.db, id), result.cached ? `Đã có chữ của tệp (${result.charCount} ký tự)` : `Đã đọc: ${result.summary}, ${result.charCount} ký tự`);
  }],
  ["GET", /^\/api\/files$/, async ({ response, url, service }) => sendOk(response, await listFiles(service.db, url.searchParams))],
  ["GET", /^\/api\/files\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getFile(service.db, parseId(match[1])))],
  // ?inline=1 → ảnh hiện thẳng trong khung chat (đúng Content-Type ảnh; máy chủ bật nosniff nên octet-stream sẽ không vẽ được)
  ["GET", /^\/api\/files\/(\d+)\/download$/, async ({ response, match, url, service }) => {
    const [rows] = await service.db.query<RowDataPacket[]>(
      "SELECT storage_key FROM attachment WHERE id = ? AND status = ?", [parseId(match[1]), AttachmentStatus.Stored]);
    const key = rows[0]?.storage_key as string | undefined;
    if (!key) throw new ApiError(404, "not_found", "Tệp chưa có trong kho");
    const stream = await service.storage.read(key);
    const downloadName = key.split("/").pop() ?? "tep";
    const imageType = IMAGE_TYPES[(/\.([a-z0-9]{1,10})$/i.exec(downloadName)?.[1] ?? "").toLowerCase()];
    const inline = url.searchParams.get("inline") === "1" && Boolean(imageType);
    response.writeHead(200, {
      "Content-Type": inline ? imageType : "application/octet-stream",
      "Cache-Control": inline ? "private, max-age=3600" : "no-store",
      // Tên tệp tiếng Việt: filename* theo RFC 5987, kèm bản ASCII cho trình duyệt cũ
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${downloadName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    });
    stream.pipe(response);
  }],
  ["POST", /^\/api\/files\/(\d+)\/retry$/, async ({ response, match, service }) => {
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
