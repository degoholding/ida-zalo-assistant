import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { ConversationType } from "../../constants.js";
import { MAX_MESSAGES, MESSAGE_SELECT, formatLines, formatVn, parseTime, type MessageLineRow } from "../../assistant/message-line-format.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import type { ToolDefinition } from "../tool-definition.js";
import { CONFIDENTIAL_NOTICE } from "./confidential-notice.js";

// get_group_messages (mặt trợ lý): đọc cả tin của MỘT nhóm trong khoảng thời gian để tóm tắt, trả CHỮ theo khuôn dòng `[ngày giờ] Người gửi: nội dung`
// (mặc định 24 giờ gần nhất, trần 1 500 tin — giữ phần mới nhất). Hỏi trong nhóm: `ctx.groupScopeId` ĐÈ `group_id` mô hình truyền (không đọc nhóm khác).
// Phân biệt «bị Mật chặn» (nhóm trong phạm vi nhưng Mật tắt) với «không có» (ngoài phạm vi — không lộ).

const DAY_MS = 86_400_000;

const inputSchema = z.object({
  group_id: z.number().int().describe("id nhóm lấy từ list_groups"),
  from: z.string().describe("Bắt đầu, ISO 8601 có múi giờ, vd 2026-10-01T00:00:00+07:00"),
  to: z.string().describe("Kết thúc, ISO 8601 có múi giờ"),
});
type GroupMessagesInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  group: z.string(), from: z.string(), to: z.string(), message_count: z.number(), truncated: z.boolean(), messages: z.string(),
});
type GroupMessagesOutput = z.infer<typeof outputSchema>;

async function findReadableGroup(ctx: DataAccessContext, groupId: number): Promise<RowDataPacket | undefined> {
  const visible = threadVisibilitySql(ctx, "g");
  const [rows] = await ctx.db.query<RowDataPacket[]>(
    `SELECT g.id, g.name FROM zalo_group g WHERE g.id = ? AND g.thread_type = ? AND ${visible.sql}`, [groupId, ConversationType.Group, ...visible.params]);
  return rows[0];
}

export const groupMessagesPresenterTool: ToolDefinition<GroupMessagesInput, GroupMessagesOutput> = {
  name: "get_group_messages",
  title: "Đọc tin của một nhóm",
  description: "Lấy toàn bộ tin của MỘT nhóm trong khoảng thời gian, để tóm tắt nhóm. Mỗi dòng: [ngày giờ] Người gửi: nội dung.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_model"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const groupId = ctx.groupScopeId ?? input.group_id;
    const to = parseTime(input.to, ctx.now);
    const from = parseTime(input.from, new Date(to.getTime() - DAY_MS));
    if (!Number.isSafeInteger(groupId) || groupId <= 0) throw new DataAccessError("invalid_value", "Thiếu hoặc sai group_id — gọi list_groups để lấy id đúng.");
    let group: RowDataPacket | undefined;
    let rows: MessageLineRow[];
    try {
      group = await findReadableGroup(ctx, groupId);
      if (!group) {
        // Thấy được nếu bỏ chặn Mật (vẫn trong phạm vi người hỏi) = bị Mật chặn; không thì như «không có» (không lộ nhóm ngoài phạm vi)
        if (!ctx.includeConfidential && (await findReadableGroup({ ...ctx, includeConfidential: true }, groupId))) throw new DataAccessError("confidential", CONFIDENTIAL_NOTICE);
        throw new DataAccessError("not_found", "Không có nhóm này hoặc nhóm không được lưu tin — gọi list_groups để lấy id đúng.");
      }
      [rows] = await ctx.db.query<MessageLineRow[]>(
        `${MESSAGE_SELECT}
         WHERE m.group_id = ? AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL
         ORDER BY m.sent_at DESC LIMIT ?`,
        [groupId, from, to, MAX_MESSAGES],
      );
    } catch (error) {
      if (error instanceof DataAccessError) throw error;
      return translateDbError(error);
    }
    rows.reverse();
    const { text, truncated } = formatLines(rows, false);
    const structured = {
      group: String(group.name ?? ""), from: formatVn(from), to: formatVn(to), message_count: rows.length,
      truncated: truncated || rows.length >= MAX_MESSAGES, messages: text || "(không có tin nào trong khoảng này)",
    };
    return { structured, summary: `Nhóm «${structured.group}»: ${rows.length} tin.`, rowCount: rows.length, entity: "messages" };
  },
};
