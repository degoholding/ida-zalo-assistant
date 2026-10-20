// mcp-guard: legacy(files) — search_files / read_file / send_file đọc DB trực tiếp; phase 7 chuyển sang họ `files`
import type { RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType } from "../constants.js";
import { DataAccessError } from "../data-access/data-access-errors.js";
import { assertAttachmentReadable, threadVisibilitySql } from "../data-access/visibility-guards.js";
import type { Db } from "../db/pool.js";
import { CONFIDENTIAL_ERROR, relaxConfidential, type AskerAccess } from "./infra/asker-access.js";
import { isRetryableFileSourceUrl, type ReadFileResult } from "./file-reader.js";
import { formatVn, parseTime } from "./message-line-format.js";

// Ba công cụ tệp của trợ lý (search_files, read_file, send_file) — vá H1: id tệp là số tăng dần, mô hình (hoặc tin nhắn
// «dụ» nó) đoán id là lấy được tệp ở cuộc riêng của người khác. Mọi đường đều qua `assertAttachmentReadable` /
// `threadVisibilitySql` với ngữ cảnh người hỏi; ngoài phạm vi trả như «không có» (không lộ tệp có tồn tại).

export const MAX_FILES_PER_TURN = 3;
/** Chữ đưa cho mô hình tối đa ngần này ký tự một lượt — hơn thì cắt và nói rõ. */
const READ_FILE_MAX_CHARS = 60_000;
/** Đúng câu báo của readAttachmentText (file-reader.ts) khi tệp chưa Stored — chỉ khi khớp câu NÀY mới thử tải lại,
 * tránh tải lại oan cho lỗi khác (đuôi tệp bị chặn, quá cỡ…) vẫn đi qua cùng nhánh "error" in result. */
const NOT_STORED_ERROR_PATTERN = /chưa có trong kho/;

export interface FileToolContext {
  db: Db;
  askerUid: string;
  now: Date;
  access: AskerAccess;
  filesToSend: number[];
  scopeGroupId?: number;
  usage?: { inputTokens: number; outputTokens: number };
  readFile?: (attachmentId: number) => Promise<ReadFileResult | { error: string }>;
  requestFileDownload?: (attachmentId: number) => Promise<"stored" | "pending" | "failed">;
  markHeavy?: (reason: string) => void;
}

/** ok = đọc được; confidential = chỉ bị Mật chặn (trong phạm vi người hỏi); missing = không có / ngoài phạm vi. */
async function attachmentAccess(access: AskerAccess, attachmentId: number): Promise<"ok" | "confidential" | "missing"> {
  const check = async (ctx: AskerAccess) => {
    try {
      await assertAttachmentReadable(ctx, attachmentId);
      return true;
    } catch (error) {
      if (error instanceof DataAccessError && error.code === "not_found") return false;
      throw error;
    }
  };
  if (await check(access)) return "ok";
  if (!access.includeConfidential && await check(relaxConfidential(access))) return "confidential";
  return "missing";
}

export async function searchFiles(context: FileToolContext, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const groupId = context.scopeGroupId ?? (Number(args.group_id) || 0);
  const from = parseTime(args.from, new Date(0));
  const to = parseTime(args.to, new Date(context.now.getTime() + 86_400_000));
  // Mỗi từ khóa phải xuất hiện trong tên tệp hoặc chú thích — "bao gia thanh cong" khớp
  // "Báo giá DL Thành Công.xlsx" dù khác thứ tự chữ ở giữa
  const words = query.split(/\s+/).filter((word) => word.length >= 2).slice(0, 6);
  // Không từ khóa = tệp gần đây của CHÍNH người hỏi (họ gửi, hoặc nằm trong cuộc riêng của họ với bot) — để bot liệt kê cho chọn
  // Có từ khóa: khớp tên tệp, chú thích, hoặc CHỮ ĐÃ BÓC từ tệp (attachment_text) — tệp bot từng đọc thì tìm được theo nội dung
  // Trong nhóm, không từ khóa = tệp gần đây của nhóm đó
  const conditions = words.length
    ? words.map(() => "(a.file_name LIKE ? OR m.text LIKE ? OR t.text LIKE ?)").join(" AND ")
    : context.scopeGroupId ? "1 = 1" : `(m.sender_uid = ? OR (g.thread_type = ${ConversationType.Direct} AND g.zalo_group_id = ?))`;
  const conditionParams = words.length
    ? words.flatMap((word) => [`%${word}%`, `%${word}%`, `%${word}%`])
    : context.scopeGroupId ? [] : [context.askerUid, context.askerUid];
  const visible = threadVisibilitySql(context.access, "g");
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT a.id, a.file_name, a.file_ext, a.status, a.stored_bytes, a.declared_size, m.sent_at, m.sender_name, m.zalo_msg_type,
            COALESCE(NULLIF(g.label, ''), g.name) AS group_name, g.thread_type, t.char_count AS text_chars
     FROM attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
     LEFT JOIN attachment_text t ON t.attachment_id = a.id
     WHERE ${conditions} AND (? = 0 OR a.group_id = ?) AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL
       AND ${visible.sql}
     ORDER BY m.sent_at DESC LIMIT 20`,
    [...conditionParams, groupId, groupId, from, to, ...visible.params],
  );
  return {
    files: rows.map((row) => ({
      id: row.id,
      name: row.file_name || `(${row.zalo_msg_type})`,
      group: row.thread_type === ConversationType.Direct ? "nhắn riêng bot" : row.group_name,
      sender: row.sender_name,
      sent: formatVn(row.sent_at),
      size_kb: Math.round(((row.stored_bytes ?? row.declared_size) || 0) / 1024),
      can_send: row.status === AttachmentStatus.Stored,
      can_read: row.status === AttachmentStatus.Stored,
      // Dòng tự đọc ảnh hỏng có char_count = 0 nhưng chưa có chữ — chưa tính là đã đọc
      already_read: Number(row.text_chars ?? 0) > 0,
    })),
  };
}

export async function readFile(context: FileToolContext, args: Record<string, unknown>) {
  if (!context.readFile) return { error: "Bot chưa bật đọc tệp" };
  const attachmentId = Number(args.attachment_id);
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return { error: "Thiếu attachment_id" };
  const [owner] = await context.db.query<RowDataPacket[]>("SELECT a.group_id, a.source_url FROM attachment a WHERE a.id = ?", [attachmentId]);
  // Kiểm quyền TRƯỚC, và tệp ngoài nhóm đang hỏi cũng chỉ báo «Không có tệp này» — không lộ việc tệp có tồn tại ở nơi khác
  const allowed = await attachmentAccess(context.access, attachmentId);
  if (allowed === "missing") return { error: "Không có tệp này." };
  if (context.scopeGroupId && Number(owner[0]?.group_id) !== context.scopeGroupId) return { error: "Không có tệp này." };
  if (allowed === "confidential") return { error: CONFIDENTIAL_ERROR };
  let result = await context.readFile(attachmentId);
  // Tệp chưa có trong kho (Skip / Failed / Pending) nhưng còn link Zalo (`source_url`) — người hỏi CHỦ ĐỘNG muốn đọc
  // (không chỉ "nhóm chưa bật lấy file" là xong chuyện): đưa lại hàng tải rồi CHỜ ít lâu, đọc luôn trong lượt này thay
  // vì bắt người hỏi gửi lại tệp (real case VPS 10/10/2026: nhóm capture_files=0, link Zalo vẫn còn hiệu lực).
  if ("error" in result && context.requestFileDownload && isRetryableFileSourceUrl(owner[0]?.source_url) && NOT_STORED_ERROR_PATTERN.test(String(result.error))) {
    const outcome = await context.requestFileDownload(attachmentId);
    if (outcome === "pending") return { error: "Em đang tải tệp này về, anh/chị hỏi lại giúp em sau ít phút nhé." };
    if (outcome === "failed") return { error: "Link tệp này trên Zalo đã hết hạn — anh/chị gửi lại tệp giúp em nhé." };
    result = await context.readFile(attachmentId); // outcome === "stored" → đọc lại, cỡ tệp / đuôi tệp vẫn được kiểm như bình thường
  }
  if ("error" in result) return result;
  if (context.usage) {
    context.usage.inputTokens += result.inputTokens;
    context.usage.outputTokens += result.outputTokens;
  }
  context.markHeavy?.(`đọc tệp ${result.fileName}`);
  const truncated = result.text.length > READ_FILE_MAX_CHARS;
  return {
    file: result.fileName,
    how: result.method,
    summary: result.summary,
    char_count: result.charCount,
    truncated,
    content: truncated ? result.text.slice(0, READ_FILE_MAX_CHARS) : result.text,
  };
}

export async function sendFile(context: FileToolContext, args: Record<string, unknown>) {
  const attachmentId = Number(args.attachment_id);
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return { error: "Thiếu attachment_id" };
  if (context.filesToSend.length >= MAX_FILES_PER_TURN) return { error: `Mỗi lần chỉ gửi tối đa ${MAX_FILES_PER_TURN} tệp.` };
  const allowed = await attachmentAccess(context.access, attachmentId);
  if (allowed === "confidential") return { error: CONFIDENTIAL_ERROR };
  if (allowed === "missing") return { error: "Không có tệp này." };
  const [rows] = await context.db.query<RowDataPacket[]>("SELECT a.id, a.file_name, a.status FROM attachment a WHERE a.id = ?", [attachmentId]);
  const file = rows[0];
  if (!file) return { error: "Không có tệp này." };
  if (file.status !== AttachmentStatus.Stored) return { error: "Tệp này chưa có trong kho (link Zalo hết hạn hoặc nhóm không bật lấy file)." };
  if (!context.filesToSend.includes(attachmentId)) context.filesToSend.push(attachmentId);
  return { queued: true, name: file.file_name };
}
