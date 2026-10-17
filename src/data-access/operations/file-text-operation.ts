import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { canUse } from "../data-access-context.js";
import { translateDbError } from "../data-access-errors.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { assertAttachmentReadable } from "../visibility-guards.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// get_file_text: đọc chữ ĐÃ bóc từ tệp (bảng attachment_text). Không tải tệp, không gọi Gemini để bóc — tệp chưa bóc thì báo
// trạng thái. Đọc từng đoạn bằng offset_chars (≤ 50 000 ký tự mỗi lần).

const DEFAULT_CHARS = 20_000;
const MAX_CHARS = 50_000;

const inputSchema = z.object({
  attachment_id: z.number().int().positive().describe("Id tệp (cột id của files)."),
  offset_chars: z.number().int().min(0).optional().describe("Bắt đầu đọc từ ký tự thứ mấy (mặc định 0)."),
  max_chars: z.number().int().min(1).max(MAX_CHARS).optional().describe(`Số ký tự tối đa (mặc định ${DEFAULT_CHARS}, tối đa ${MAX_CHARS}).`),
});
type FileTextInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  attachment_id: z.number(),
  file_name: z.string(),
  status: z.enum(["ok", "not_extracted", "unsupported", "empty"]),
  method: z.string().nullable(),
  total_chars: z.number(),
  offset_chars: z.number(),
  returned_chars: z.number(),
  has_more: z.boolean(),
  next_offset_chars: z.number().nullable(),
  text: z.string(),
  untrusted_fields: z.array(z.string()),
  notices: z.array(z.string()),
});
type FileTextOutput = z.infer<typeof outputSchema>;

export const fileTextTool: ToolDefinition<FileTextInput, FileTextOutput> = {
  name: "get_file_text",
  title: "Đọc chữ trong tệp",
  description: `Đọc chữ đã bóc từ một tệp (Excel, Word, PDF, ảnh…) trong cuộc trò chuyện. Chỉ đọc chữ đã có sẵn; tệp chưa bóc chữ sẽ báo not_extracted. ${UNTRUSTED_NOTICE}`,
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "file", "read"),
  async handler(ctx, input) {
    await assertAttachmentReadable(ctx, input.attachment_id);
    const offset = input.offset_chars ?? 0;
    const max = input.max_chars ?? DEFAULT_CHARS;
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(
        `SELECT ${QUERY_TIME_HINT} a.file_name, t.method, CHAR_LENGTH(t.text) AS total, SUBSTRING(t.text, ?, ?) AS chunk
         FROM attachment a LEFT JOIN attachment_text t ON t.attachment_id = a.id WHERE a.id = ?`, [offset + 1, max, input.attachment_id]);
    } catch (error) {
      return translateDbError(error);
    }
    const row = rows[0] ?? {};
    const method = row.method === null || row.method === undefined ? null : String(row.method);
    const total = Number(row.total ?? 0);
    const text = row.chunk === null || row.chunk === undefined ? "" : String(row.chunk);
    const status: FileTextOutput["status"] = method === null ? "not_extracted" : method === "unsupported" ? "unsupported" : total === 0 ? "empty" : "ok";
    // MySQL đếm theo ký tự Unicode (không phải đơn vị UTF-16) — đếm cùng cách để offset khớp
    const returned = Array.from(text).length;
    const hasMore = offset + returned < total;
    const notices = status === "not_extracted" ? ["Tệp chưa được bóc chữ — nhờ người dùng mở tệp trên web (nút Đọc) hoặc hỏi bot trong Zalo."] : [];
    const structured: FileTextOutput = {
      attachment_id: input.attachment_id, file_name: String(row.file_name ?? ""), status, method, total_chars: total, offset_chars: offset,
      returned_chars: returned, has_more: hasMore, next_offset_chars: hasMore ? offset + returned : null, text,
      untrusted_fields: ["text", "file_name"], notices,
    };
    return { structured, summary: `Tệp ${input.attachment_id}: ${status}, ${returned}/${total} ký tự.`, rowCount: status === "ok" ? 1 : 0 };
  },
};
