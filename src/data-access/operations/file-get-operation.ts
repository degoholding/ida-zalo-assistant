import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { classifyForReading, extensionOf, extractDocx, extractSheet, MAX_TEXT_CHARS } from "../../assistant/file-reader.js";
import { AttachmentStatus } from "../../constants.js";
import { sniffImageType } from "../../storage/image-type-sniff.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { assertAttachmentReadable } from "../visibility-guards.js";
import { UNTRUSTED_NOTICE, type ToolDefinition, type ToolMediaBlock } from "../tool-definition.js";

// get_file (27/10/2026): đưa tệp cho ứng dụng AI ngoài (Claude, ChatGPT…) tự đọc — bot không đọc giùm, không tốn AI phía bot.
//   xlsx/docx/csv/txt → bóc chữ tại chỗ bằng mã sẵn có (không gọi mô hình), trả chữ theo đoạn (chữ đi qua che dữ liệu cá nhân của
//                       runTool như mọi công cụ); chưa có chữ cache thì cất vào attachment_text (có rồi thì KHÔNG ghi đè)
//   ảnh / pdf / tệp lớn → tệp GỐC khi bật công tắc MCP_FILE_RAW (mặc định BẬT — đại ca chốt 27/10: NGOẠI LỆ của che dữ liệu cá nhân,
//                       chỉ Quản trị / Quản lý dùng MCP): ảnh = khối image, pdf = embedded resource, lớn hơn trần = link tải ký sẵn
//                       5 phút qua chính bot. Công tắc tắt: trả chữ đã bóc sẵn (nếu có, đã che), không tệp gốc, không link.
//   ghi âm / video    → báo AI ngoài không nghe / xem được; ghi âm đã gỡ băng thì chỉ sang get_file_text
// Cùng luật phạm vi + nhóm Mật với get_file_text (assertAttachmentReadable). Chỉ cổng ngoài `mcp_http` (cần ctx.fileAccess).

export const IMAGE_INLINE_MAX_BYTES = 3 * 1024 * 1024;
export const PDF_INLINE_MAX_BYTES = 5 * 1024 * 1024;
/** Tệp chữ / bảng tính / docx đọc vào bộ nhớ để bóc tối đa ngần này. */
export const EXTRACT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_CHARS = 20_000;
const MAX_CHARS = 50_000;
/** Trần mỗi khóa MCP mỗi phút: số tệp gọi + số byte nhúng vào kết quả. */
export const FILES_PER_MINUTE = 20;
export const INLINE_BYTES_PER_MINUTE = 40 * 1024 * 1024;
const RAW_OFF_NOTICE = "Máy chủ đang TẮT trả tệp gốc cho AI ngoài (MCP_FILE_RAW) để giữ luật che dữ liệu cá nhân — chỉ trả chữ đã bóc.";
const RAW_EXCEPTION_NOTICE = "Tệp gốc KHÔNG được che số điện thoại / số tài khoản / CCCD (ngoại lệ của che dữ liệu cá nhân) — chỉ dùng cho việc nội bộ.";

const inputSchema = z.object({
  attachment_id: z.number().int().positive().describe("Id tệp (cột id của files)."),
  offset_chars: z.number().int().min(0).optional().describe("Với chữ trả về: đọc từ ký tự thứ mấy (mặc định 0)."),
  max_chars: z.number().int().min(1).max(MAX_CHARS).optional().describe(`Số ký tự tối đa (mặc định ${DEFAULT_CHARS}, tối đa ${MAX_CHARS}).`),
});
type FileGetInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  attachment_id: z.number(),
  file_name: z.string(),
  kind: z.string(),
  status: z.enum(["ok", "link", "not_stored", "unsupported", "not_extracted"]),
  delivered: z.enum(["image", "resource", "text", "link", "none"]),
  mime_type: z.string().nullable(),
  bytes: z.number().nullable(),
  text: z.string(),
  total_chars: z.number(),
  offset_chars: z.number(),
  has_more: z.boolean(),
  next_offset_chars: z.number().nullable(),
  download_url: z.string().nullable(),
  download_expires_in_seconds: z.number().nullable(),
  untrusted_fields: z.array(z.string()),
  notices: z.array(z.string()),
});
type FileGetOutput = z.infer<typeof outputSchema>;

// ---- trần mỗi khóa mỗi phút (bộ nhớ tiến trình) ----

interface Usage { windowStart: number; files: number; bytes: number }
const usageByKey = new Map<string, Usage>();

/** Kiểm + ghi một lượt gọi (`bytes` = phần định nhúng vào kết quả). Ném rate_limited khi vượt — gọi TRƯỚC khi đọc tệp. */
export function chargeFileQuota(key: string, bytes: number, nowMs = Date.now()): void {
  let usage = usageByKey.get(key);
  if (!usage || nowMs - usage.windowStart >= 60_000) {
    usage = { windowStart: nowMs, files: 0, bytes: 0 };
    usageByKey.set(key, usage);
  }
  if (usage.files + 1 > FILES_PER_MINUTE || usage.bytes + bytes > INLINE_BYTES_PER_MINUTE) {
    throw new DataAccessError("rate_limited", `Lấy tệp quá nhiều trong một phút (tối đa ${FILES_PER_MINUTE} tệp / ${INLINE_BYTES_PER_MINUTE / 1024 / 1024} MB) — đợi một phút rồi thử lại.`);
  }
  usage.files += 1;
  usage.bytes += bytes;
}

export function resetFileQuota(): void {
  usageByKey.clear();
}

const quotaKey = (ctx: DataAccessContext) => `k${ctx.keyId ?? 0}:u${ctx.principal.userId ?? 0}`;

function baseOutput(row: RowDataPacket, input: FileGetInput, kind: string): FileGetOutput {
  return {
    attachment_id: input.attachment_id, file_name: String(row.file_name ?? ""), kind, status: "ok", delivered: "none", mime_type: null,
    bytes: row.stored_bytes === null || row.stored_bytes === undefined ? null : Number(row.stored_bytes), text: "", total_chars: 0,
    offset_chars: input.offset_chars ?? 0, has_more: false, next_offset_chars: null, download_url: null, download_expires_in_seconds: null,
    untrusted_fields: ["text", "file_name"], notices: [],
  };
}

function withLink(ctx: DataAccessContext, output: FileGetOutput, attachmentId: number): FileGetOutput {
  const url = ctx.fileAccess?.signLink(attachmentId) ?? null;
  if (!url) {
    output.notices.push("Máy chủ chưa khai địa chỉ công khai (MCP_PUBLIC_URL) nên không tạo được link tải — tải tệp ở trang quản trị bot, màn Tệp.");
    return output;
  }
  return { ...output, download_url: url, download_expires_in_seconds: 300 };
}

/** Cắt một đoạn chữ theo ký tự Unicode (khớp cách đếm của MySQL / get_file_text). */
function withText(output: FileGetOutput, text: string, input: FileGetInput): FileGetOutput {
  const all = Array.from(text);
  const offset = input.offset_chars ?? 0;
  const chunk = all.slice(offset, offset + (input.max_chars ?? DEFAULT_CHARS)).join("");
  const returned = Array.from(chunk).length;
  const hasMore = offset + returned < all.length;
  return { ...output, delivered: "text", text: chunk, total_chars: all.length, has_more: hasMore, next_offset_chars: hasMore ? offset + returned : null };
}

/** Bóc chữ tại chỗ (không gọi mô hình). Chỉ text / sheet / docx. */
function extractLocally(kind: string, data: Buffer): { method: "text" | "xlsx" | "docx"; text: string; summary: string } {
  if (kind === "sheet") return { method: "xlsx", ...extractSheet(data) };
  if (kind === "docx") {
    const text = extractDocx(data);
    return { method: "docx", text, summary: `Tài liệu Word, ${text.length} ký tự` };
  }
  const text = data.toString("utf8").replace(/^\uFEFF/, "").slice(0, MAX_TEXT_CHARS);
  return { method: "text", text, summary: `Tệp chữ, ${text.length} ký tự` };
}

export const fileGetTool: ToolDefinition<FileGetInput, FileGetOutput> = {
  name: "get_file",
  title: "Lấy tệp",
  description: "Lấy tệp trong cuộc trò chuyện để tự đọc: Excel / Word / CSV / txt trả chữ đã bóc (đọc từng đoạn bằng offset_chars). " +
    "Ảnh / PDF trả TỆP GỐC (ảnh, tệp nhúng; tệp lớn trả download_url hạn 5 phút) — tệp gốc là NGOẠI LỆ của che dữ liệu cá nhân: số " +
    "điện thoại / tài khoản / CCCD trong ảnh, PDF KHÔNG được che. Máy chủ tắt trả tệp gốc thì trả chữ đã bóc sẵn (nếu có) và ghi rõ trong " +
    "notices. Ghi âm / video: AI không nghe / xem được — dùng get_file_text nếu đã có chữ gỡ băng. " +
    `Lấy attachment_id từ search_files / get_thread_messages. ${UNTRUSTED_NOTICE}`,
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "file", "read") && ctx.fileAccess !== undefined,
  async handler(ctx, input) {
    await assertAttachmentReadable(ctx, input.attachment_id);
    const access = ctx.fileAccess!;
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT a.file_name, a.file_ext, a.status, a.storage_key, a.stored_bytes, t.method AS text_method, t.text AS cached_text
       FROM attachment a LEFT JOIN attachment_text t ON t.attachment_id = a.id WHERE a.id = ?`, [input.attachment_id]);
    const row = rows[0] ?? {};
    const { kind } = classifyForReading(extensionOf(String(row.file_name ?? ""), String(row.file_ext ?? "")));
    let output = baseOutput(row, input, kind);
    const cachedText = row.cached_text === null || row.cached_text === undefined ? null : String(row.cached_text);
    const status = Number(row.status);
    const bytes = output.bytes ?? 0;

    if (kind === "audio" || kind === "video") {
      chargeFileQuota(quotaKey(ctx), 0);
      output = { ...output, status: "unsupported" };
      if (access.rawAllowed && status === AttachmentStatus.Stored && row.storage_key) output = withLink(ctx, { ...output, delivered: "link" }, input.attachment_id);
      output.notices.push(kind === "audio"
        ? (row.text_method === "gemini" ? "AI không nghe được tệp ghi âm. Tệp này ĐÃ có chữ gỡ băng — gọi get_file_text." : "AI không nghe được tệp ghi âm và tệp chưa được gỡ băng.")
        : "AI không xem được video.");
      return { structured: output, summary: `Tệp ${input.attachment_id}: ${kind === "audio" ? "ghi âm" : "video"}, không đọc được.`, rowCount: 0 };
    }

    // Chữ đã bóc sẵn dùng được ở mọi trạng thái kho (kể cả tệp gốc đã quá hạn)
    const fromCache = (note: string) => {
      chargeFileQuota(quotaKey(ctx), 0);
      const result = withText({ ...output, notices: [...output.notices] }, cachedText ?? "", input);
      result.notices.push(note);
      return { structured: result, summary: `Tệp ${input.attachment_id}: trả chữ đã bóc sẵn ${Array.from(result.text).length}/${result.total_chars} ký tự.`, rowCount: 1 };
    };

    if (status !== AttachmentStatus.Stored || !row.storage_key) {
      const reason = status === AttachmentStatus.Skipped ? "Nhóm này không bật Lấy file nên bot không giữ tệp gốc."
        : status === AttachmentStatus.Expired ? "Tệp gốc đã quá hạn giữ và bị xóa."
          : "Tệp chưa tải xong về kho (đang chờ hoặc tải lỗi).";
      if (cachedText) return fromCache(`${reason} Trả chữ đã bóc sẵn.`);
      chargeFileQuota(quotaKey(ctx), 0);
      output.status = "not_stored";
      output.notices.push(reason);
      return { structured: output, summary: `Tệp ${input.attachment_id}: chưa có tệp gốc trong kho.`, rowCount: 0 };
    }
    const storageKey = String(row.storage_key);

    if (kind === "text" || kind === "sheet" || kind === "docx") {
      if (cachedText !== null) return fromCache("Chữ đã bóc sẵn từ trước.");
      if (bytes > EXTRACT_MAX_BYTES) {
        chargeFileQuota(quotaKey(ctx), 0);
        output = access.rawAllowed ? withLink(ctx, { ...output, status: "link", delivered: "link" }, input.attachment_id) : { ...output, status: "unsupported" };
        output.notices.push(`Tệp quá lớn để bóc chữ (trên ${EXTRACT_MAX_BYTES / 1024 / 1024} MB).`);
        return { structured: output, summary: `Tệp ${input.attachment_id}: quá lớn để bóc chữ.`, rowCount: 0 };
      }
      chargeFileQuota(quotaKey(ctx), 0);
      const extracted = extractLocally(kind, await access.read(storageKey, EXTRACT_MAX_BYTES));
      // Cất vào attachment_text CHỈ khi chưa có dòng — không đè chữ đã bóc trước đó (review 27/10)
      await ctx.db.query(
        "INSERT IGNORE INTO attachment_text (attachment_id, method, char_count, summary, text, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, 0, 0)",
        [input.attachment_id, extracted.method, extracted.text.length, extracted.summary.slice(0, 500), extracted.text]);
      output = withText(output, extracted.text, input);
      return { structured: output, summary: `Tệp ${input.attachment_id}: ${extracted.summary}; trả ${Array.from(output.text).length}/${output.total_chars} ký tự.`, rowCount: 1 };
    }

    if (!access.rawAllowed) {
      if (cachedText) return fromCache(RAW_OFF_NOTICE);
      chargeFileQuota(quotaKey(ctx), 0);
      output = { ...output, status: "not_extracted" };
      output.notices.push(`${RAW_OFF_NOTICE} Tệp này chưa có chữ bóc sẵn — nhờ người dùng bấm Đọc ở màn Tệp hoặc hỏi bot trong Zalo.`);
      return { structured: output, summary: `Tệp ${input.attachment_id}: chưa có chữ, tệp gốc đang tắt.`, rowCount: 0 };
    }

    if (kind === "image" || kind === "pdf") {
      const limit = kind === "image" ? IMAGE_INLINE_MAX_BYTES : PDF_INLINE_MAX_BYTES;
      if (bytes > limit) {
        chargeFileQuota(quotaKey(ctx), 0);
        output = withLink(ctx, { ...output, status: "link", delivered: "link" }, input.attachment_id);
        output.notices.push(`Tệp ${Math.round(bytes / 1024)} KB quá trần nhúng ${limit / 1024 / 1024} MB — tải qua download_url.`, RAW_EXCEPTION_NOTICE);
        return { structured: output, summary: `Tệp ${input.attachment_id}: quá lớn, trả link tải.`, rowCount: 1 };
      }
      chargeFileQuota(quotaKey(ctx), bytes);
      const data = await access.read(storageKey, limit);
      if (kind === "image") {
        const sniffed = sniffImageType(data);
        if (!sniffed) {
          output = withLink(ctx, { ...output, status: "link", delivered: "link" }, input.attachment_id);
          output.notices.push("Không nhận ra định dạng ảnh — tải qua download_url.");
          return { structured: output, summary: `Tệp ${input.attachment_id}: ảnh lạ, trả link.`, rowCount: 1 };
        }
        const media: ToolMediaBlock[] = [{ type: "image", data: data.toString("base64"), mimeType: sniffed.mime }];
        output = { ...output, delivered: "image", mime_type: sniffed.mime, bytes: data.length, notices: [...output.notices, RAW_EXCEPTION_NOTICE] };
        return { structured: output, summary: `Tệp ${input.attachment_id}: ảnh ${sniffed.mime}, ${Math.round(data.length / 1024)} KB (khối image kèm theo).`, rowCount: 1, media };
      }
      const media: ToolMediaBlock[] = [{ type: "resource", resource: { uri: `attachment://${input.attachment_id}`, mimeType: "application/pdf", blob: data.toString("base64") } }];
      output = { ...output, delivered: "resource", mime_type: "application/pdf", bytes: data.length, notices: [...output.notices, RAW_EXCEPTION_NOTICE] };
      return { structured: output, summary: `Tệp ${input.attachment_id}: PDF ${Math.round(data.length / 1024)} KB (tệp nhúng kèm theo).`, rowCount: 1, media };
    }

    chargeFileQuota(quotaKey(ctx), 0);
    output = withLink(ctx, { ...output, status: "unsupported", delivered: "link" }, input.attachment_id);
    output.notices.push("Loại tệp này không đọc được trực tiếp — tải qua download_url.");
    return { structured: output, summary: `Tệp ${input.attachment_id}: loại chưa hỗ trợ, trả link tải.`, rowCount: 0 };
  },
};
