import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { attachmentAccessOf, FILE_NOT_FOUND } from "./file-access-check.js";
import { CONFIDENTIAL_NOTICE } from "../reads/confidential-notice.js";
import type { ToolDefinition } from "../tool-definition.js";

// file_read_prepare (mặt LỆNH `assistant_command`, mô hình không thấy): bước đầu của `read_file` — kiểm quyền đọc tệp (cùng chốt chặn `assertAttachmentReadable`;
// Mật chặn trả câu Mật, ngoài phạm vi / ngoài nhóm đang hỏi trả «Không có tệp này.»), rồi đưa phía trợ lý dòng tệp + chữ đã bóc (nếu có) + cờ «link Zalo còn tải lại được».
// Việc tải kho / bóc chữ bằng AI nằm NGOÀI MCP (tác động ngoài); `storage_key` chỉ đi trong lệnh nội bộ này, không bao giờ tới mô hình.

const inputSchema = z.object({ attachment_id: z.number().int().positive() });
type PrepareInput = z.infer<typeof inputSchema>;

export const EXTRACT_METHODS = ["text", "xlsx", "docx", "gemini", "unsupported"] as const;

const outputSchema = z.object({
  attachment_id: z.number(),
  group_id: z.number(),
  file_name: z.string(),
  file_ext: z.string(),
  status: z.number(),
  storage_key: z.string().nullable(),
  stored_bytes: z.number().nullable(),
  /** `source_url` còn là link http(s) tải lại được (Zalo CDN) — không đưa chính link ra. */
  source_retryable: z.boolean(),
  cached: z.object({ method: z.enum(EXTRACT_METHODS), summary: z.string(), text: z.string(), char_count: z.number() }).nullable(),
});
type PrepareOutput = z.infer<typeof outputSchema>;

export const fileReadPrepareTool: ToolDefinition<PrepareInput, PrepareOutput> = {
  name: "file_read_prepare",
  title: "Chuẩn bị đọc tệp (kiểm quyền + chữ đã bóc)",
  description: "Kiểm quyền đọc một tệp và trả dòng tệp + chữ đã bóc nếu có. Chỉ lệnh nội bộ của trợ lý.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "files",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "file", "read"),
  async handler(ctx, input) {
    const access = await attachmentAccessOf(ctx, input.attachment_id);
    if (access === "missing") throw new DataAccessError("not_found", FILE_NOT_FOUND);
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(
        `SELECT ${QUERY_TIME_HINT} a.id, a.group_id, a.file_name, a.file_ext, a.status, a.storage_key, a.stored_bytes, a.source_url,
                t.method, t.summary, t.text, t.char_count
         FROM attachment a LEFT JOIN attachment_text t ON t.attachment_id = a.id WHERE a.id = ?`, [input.attachment_id]);
    } catch (error) {
      return translateDbError(error);
    }
    const row = rows[0];
    // Tệp ngoài nhóm đang hỏi cũng chỉ báo «Không có tệp này» — không lộ việc tệp có tồn tại ở nơi khác (kiểm TRƯỚC câu Mật như đường cũ)
    if (!row || (ctx.groupScopeId !== undefined && Number(row.group_id) !== ctx.groupScopeId)) throw new DataAccessError("not_found", FILE_NOT_FOUND);
    if (access === "confidential") throw new DataAccessError("confidential", CONFIDENTIAL_NOTICE);
    const cached = row.text !== null && row.text !== undefined
      ? { method: row.method, summary: String(row.summary ?? ""), text: String(row.text), char_count: Number(row.char_count) } : null;
    const structured: PrepareOutput = {
      attachment_id: Number(row.id), group_id: Number(row.group_id), file_name: String(row.file_name ?? ""), file_ext: String(row.file_ext ?? ""),
      status: Number(row.status), storage_key: row.storage_key ? String(row.storage_key) : null,
      stored_bytes: row.stored_bytes === null ? null : Number(row.stored_bytes),
      source_retryable: typeof row.source_url === "string" && /^https?:\/\//i.test(row.source_url), cached,
    };
    return { structured, summary: `Tệp ${structured.attachment_id}: ${cached ? "đã có chữ" : "chưa bóc chữ"}.`, rowCount: 1, entity: "files" };
  },
};
