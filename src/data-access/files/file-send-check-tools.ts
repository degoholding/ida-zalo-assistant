import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { AttachmentStatus } from "../../constants.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { FILE_NOT_FOUND, requireReadableAttachment } from "./file-access-check.js";
import type { ToolDefinition } from "../tool-definition.js";

// file_send_check (mặt LỆNH): bước dữ liệu của `send_file` — kiểm quyền + tệp đã có trong kho, rồi báo `effects.filesToSend` để lượt gửi tệp CHO CHÍNH người hỏi sau câu trả lời.
// Việc gửi qua Zalo là tác động ngoài, nằm ngoài MCP; trần `MAX_FILES_PER_TURN` do phía trợ lý giữ (nó đếm tệp của cả lượt).

const inputSchema = z.object({ attachment_id: z.number().int().positive() });
type SendInput = z.infer<typeof inputSchema>;
const outputSchema = z.object({ queued: z.boolean(), name: z.string() });

export const fileSendCheckTool: ToolDefinition<SendInput, z.infer<typeof outputSchema>> = {
  name: "file_send_check",
  title: "Kiểm tệp trước khi gửi cho người hỏi",
  description: "Kiểm quyền đọc + tệp đã có trong kho; đưa tệp vào danh sách gửi của lượt. Chỉ lệnh nội bộ của trợ lý.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "files",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "file", "read"),
  async handler(ctx, input) {
    await requireReadableAttachment(ctx, input.attachment_id);
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT ${QUERY_TIME_HINT} a.id, a.file_name, a.status FROM attachment a WHERE a.id = ?`, [input.attachment_id]);
    } catch (error) {
      return translateDbError(error);
    }
    const file = rows[0];
    if (!file) throw new DataAccessError("not_found", FILE_NOT_FOUND);
    if (Number(file.status) !== AttachmentStatus.Stored) {
      throw new DataAccessError("invalid_state", "Tệp này chưa có trong kho (link Zalo hết hạn hoặc nhóm không bật lấy file).");
    }
    const name = String(file.file_name ?? "");
    return { structured: { queued: true, name }, summary: `Tệp ${input.attachment_id} gửi được.`, rowCount: 1, entity: "files", effects: { filesToSend: [input.attachment_id] } };
  },
};
