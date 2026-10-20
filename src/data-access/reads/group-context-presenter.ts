import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { MessageKind } from "../../constants.js";
import { attachmentLabel, formatVn } from "../../assistant/message-line-format.js";
import { stripTokenFooter } from "../../assistant/token-usage-footer.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import type { ToolDefinition } from "../tool-definition.js";

// group_context (mặt LỆNH `assistant_command`, mô hình không thấy): ngữ cảnh khi bot được gọi TRONG NHÓM — vài tin gần nhất của chính nhóm đó (gồm câu bot
// vừa trả lời) để hỏi nối tiếp kiểu «chi tiết báo cáo đó» hiểu được «đó» là gì, cùng tên Zalo thành viên đang ở nhóm (để viết «@Tên» khớp thẻ nhắc).
// Nhóm lấy từ `ctx.groupScopeId` (do lớp trợ lý đặt từ tin Zalo đã nhận), KHÔNG từ tham số — không có đường đọc nhóm khác. Chép nguyên truy vấn cũ.

interface ContextRow extends RowDataPacket {
  sender_name: string; kind: number; text: string | null; sent_at: Date; file_name: string | null; attachment_id: number | null; file_text: string | null;
}

const CONTEXT_MESSAGES = 10;
const MAX_LINE_CHARS = 600;
const MAX_MEMBER_NAMES = 60;

const inputSchema = z.object({
  before_message_id: z.number().int().positive().optional().describe("Chỉ lấy tin đứng TRƯỚC tin này (tin chứa câu hỏi hiện tại)."),
});
type GroupContextInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({ member_names: z.array(z.string()), context: z.string() });
type GroupContextOutput = z.infer<typeof outputSchema>;

export const groupContextCommandTool: ToolDefinition<GroupContextInput, GroupContextOutput> = {
  name: "group_context",
  title: "Ngữ cảnh nhóm đang hỏi",
  description: "Vài tin gần nhất của nhóm đang hỏi (CHỈ để hiểu câu hỏi nối tiếp) + tên thành viên đang ở nhóm. Chỉ dùng được khi hỏi trong nhóm.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => ctx.groupScopeId !== undefined && canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const groupId = ctx.groupScopeId;
    if (groupId === undefined) throw new DataAccessError("forbidden", "group_context chỉ dùng khi hỏi trong nhóm.");
    const before = input.before_message_id ?? null;
    let messages: ContextRow[];
    let members: RowDataPacket[];
    try {
      [messages] = await ctx.db.query<ContextRow[]>(
        `SELECT m.sender_name, m.kind, m.text, m.sent_at, a.file_name, a.id AS attachment_id,
                IF(m.kind = ${MessageKind.Image}, LEFT(t.text, 2000), NULL) AS file_text
         FROM message m LEFT JOIN attachment a ON a.message_id = m.id LEFT JOIN attachment_text t ON t.attachment_id = a.id
         WHERE m.group_id = ? AND m.recalled_at IS NULL AND (? IS NULL OR m.id < ?)
           AND ((m.text IS NOT NULL AND m.text <> '') OR a.id IS NOT NULL)
         ORDER BY m.id DESC LIMIT ?`,
        [groupId, before, before, CONTEXT_MESSAGES],
      );
      [members] = await ctx.db.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM group_member
         WHERE group_id = ? AND left_at IS NULL ORDER BY first_seen_at LIMIT ?`,
        [groupId, MAX_MEMBER_NAMES],
      );
    } catch (error) {
      return translateDbError(error);
    }
    const context = messages.reverse().map((row) => {
      // Tệp / ảnh: nhãn kèm mã (ảnh đã tự đọc thì kèm chữ + mô tả) rồi chú thích nếu có
      const caption = stripTokenFooter(String(row.text ?? "")).replace(/\s+/g, " ").slice(0, MAX_LINE_CHARS);
      const body = row.attachment_id ? `${attachmentLabel(row)}${caption ? ` ${caption}` : ""}` : caption;
      return `[${formatVn(row.sent_at)}] ${row.sender_name}: ${body}`;
    }).join("\n");
    const memberNames = [...new Set(members.map((row) => String(row.name ?? "").trim()).filter((name) => name.length >= 2))];
    return { structured: { member_names: memberNames, context }, summary: `Ngữ cảnh nhóm: ${messages.length} tin, ${memberNames.length} thành viên.`, rowCount: messages.length, entity: "messages" };
  },
};
