import { z } from "zod/v4";
import { canUse } from "../data-access-context.js";
import { translateDbError } from "../data-access-errors.js";
import { requireReadableAttachment } from "./file-access-check.js";
import { EXTRACT_METHODS } from "./file-read-prepare-tools.js";
import type { ToolDefinition } from "../tool-definition.js";

// file_text_store (mặt LỆNH): GHI cache chữ đã bóc vào `attachment_text` — thao tác lõi duy nhất ghi bảng này từ trợ lý. Kiểm LẠI quyền đọc tệp trước khi ghi
// (tệp có thể đã ra khỏi phạm vi người hỏi trong lúc AI bóc chữ dài); bị từ chối thì không có dòng nào được ghi. Chữ do bước bóc (ngoài MCP) cung cấp.

/** Chữ bóc ra cất tối đa ngần này ký tự — bằng MAX_TEXT_CHARS của file-reader (nơi cắt trước khi gọi). */
const MAX_TEXT_CHARS = 200_000;

const inputSchema = z.object({
  attachment_id: z.number().int().positive(),
  method: z.enum(EXTRACT_METHODS),
  /** null khi method = unsupported (đã thử mà không đọc được — vẫn ghi dòng để ghi nhớ). */
  text: z.string().max(MAX_TEXT_CHARS).nullable(),
  summary: z.string(),
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
});
type StoreInput = z.infer<typeof inputSchema>;
const outputSchema = z.object({ stored: z.boolean(), char_count: z.number() });

export const fileTextStoreTool: ToolDefinition<StoreInput, z.infer<typeof outputSchema>> = {
  name: "file_text_store",
  title: "Lưu chữ đã bóc của tệp",
  description: "Ghi cache chữ đã bóc của một tệp (sau khi trợ lý đọc tệp lần đầu). Chỉ lệnh nội bộ của trợ lý.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "files",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "file", "read"),
  async handler(ctx, input) {
    await requireReadableAttachment(ctx, input.attachment_id);
    const text = input.text ?? "";
    try {
      await ctx.db.query(
        `INSERT INTO attachment_text (attachment_id, method, char_count, summary, text, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE method = VALUES(method), char_count = VALUES(char_count), summary = VALUES(summary), text = VALUES(text),
           input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens), extracted_at = CURRENT_TIMESTAMP(3)`,
        [input.attachment_id, input.method, text.length, input.summary.slice(0, 500), input.method === "unsupported" ? null : text, input.input_tokens, input.output_tokens]);
    } catch (error) {
      return translateDbError(error);
    }
    return { structured: { stored: true, char_count: text.length }, summary: `Đã lưu chữ của tệp ${input.attachment_id} (${text.length} ký tự).`, rowCount: 1, entity: "files" };
  },
};
