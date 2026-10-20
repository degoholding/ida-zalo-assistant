import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { ConversationType, MessagePriority, ReplyState } from "../../constants.js";
import type { DataAccessContext } from "../data-access-context.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import { ALERT_TOOL_DECLARATIONS } from "../../assistant/alert-tools.js";
import { alertToolsAvailable, askerGroupIds, requireAlertAsker } from "./alert-asker-facts.js";

// «Tin cần xử lý» (bảng `message_flag`): tin KHẨN 24 giờ qua + tin đang chờ trả lời, khẩn trước — trong phạm vi nhóm của người nhận GIAO với chốt chặn
// nhóm + Mật của lõi (`threadVisibilitySql`, vá H1). Chép đúng `listPendingItems` cũ: cột trả giữ nguyên để mô hình / lệnh gõ dựng câu y hệt.

const VN = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false });

const itemOutput = z.object({
  so: z.number(), message_id: z.number(), muc: z.string(), nhom: z.string().nullable(), nguoi_gui: z.string().nullable(), luc: z.string(), trang_thai: z.string(),
  tom_tat: z.string(), ly_do: z.string().nullable(), qua_han: z.boolean().nullable(),
});
const listOutput = z.object({ count: z.number().optional(), items: z.array(itemOutput), note: z.string().optional() });
export type PendingItemsResult = z.infer<typeof listOutput>;

const NO_GROUP_NOTE = "Anh/chị chưa được gán nhóm nào để theo dõi (màn Người nhận).";

const priorityLabel = (priority: number) => priority === MessagePriority.Urgent ? "KHẨN" : priority === MessagePriority.Important ? "quan trọng" : "thường";
const stateLabel = (state: number) =>
  state === ReplyState.Seen ? "đã có người xem (thả cảm xúc), chưa trả lời" : state === ReplyState.Waiting ? "đang chờ trả lời" : "chưa xử lý";

/** Danh sách tin cần xử lý của người hỏi cảnh báo. */
export async function listPendingItems(ctx: DataAccessContext, limitArg: number | undefined): Promise<PendingItemsResult> {
  const asker = await requireAlertAsker(ctx);
  const limit = Math.min(30, Math.max(1, Number(limitArg) || 15));
  const groups = await askerGroupIds(ctx, asker);
  if (groups && !groups.length) return { items: [], note: NO_GROUP_NOTE };
  // Phạm vi nhóm + Mật của người hỏi (như mọi công cụ đọc) GIAO với nhóm đã gán ở màn Người nhận
  const visible = threadVisibilitySql(ctx, "g");
  const [rows] = await ctx.db.query<RowDataPacket[]>(
    `SELECT m.id, COALESCE(NULLIF(g.label, ''), g.name) AS group_name, m.sender_name, m.sent_at, m.text, f.priority, f.reply_state, f.reason, f.due_at
     FROM message_flag f JOIN message m ON m.id = f.message_id JOIN zalo_group g ON g.id = m.group_id
     WHERE g.thread_type = ? AND g.read_messages = 1 AND m.recalled_at IS NULL AND ${visible.sql} ${groups ? "AND m.group_id IN (?)" : ""}
       AND (f.for_uid IS NULL OR f.for_uid = ?) AND f.pending_ai = 0
       AND (f.reply_state IN (?, ?) OR (f.priority = ? AND f.reply_state <> ? AND m.sent_at > ?))
     ORDER BY f.priority DESC, m.sent_at LIMIT ?`,
    [ConversationType.Group, ...visible.params, ...(groups ? [groups] : []), asker.uid, ReplyState.Waiting, ReplyState.Seen, MessagePriority.Urgent, ReplyState.Handled,
      new Date(ctx.now.getTime() - 86_400_000), limit]);
  return {
    count: rows.length,
    items: rows.map((row, index) => ({
      so: index + 1, message_id: Number(row.id), muc: priorityLabel(Number(row.priority)),
      nhom: row.group_name, nguoi_gui: row.sender_name, luc: VN.format(new Date(row.sent_at)), trang_thai: stateLabel(Number(row.reply_state)),
      tom_tat: String(row.text ?? "").replace(/\s+/g, " ").slice(0, 160), ly_do: row.reason,
      qua_han: row.due_at && new Date(row.due_at) <= ctx.now,
    })),
  };
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const listInput = z.object({ limit: z.number().int().optional().describe("Số tin tối đa, mặc định 15") });
type ListInput = z.infer<typeof listInput>;

const declared = (name: string): string => {
  const found = ALERT_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!found) throw new Error(`thiếu khai báo công cụ cảnh báo ${name}`);
  return found.description;
};

async function listHandler(ctx: DataAccessContext, input: ListInput) {
  const result = await listPendingItems(ctx, input.limit);
  return { structured: result, summary: `${result.items.length} tin cần xử lý`, rowCount: result.items.length, entity: "message" };
}

/** Mặt mô hình: tên + mô tả + sơ đồ giữ nguyên (`list_pending_items`); lỗi trả `{ error: "<chữ>" }` như công cụ cũ. */
const modelList: ToolDefinition<ListInput, PendingItemsResult> = {
  name: "list_pending_items", title: "Tin cần xử lý", description: declared("list_pending_items"),
  input: () => listInput, output: listOutput, annotations: READ,
  surfaces: ["assistant_model"], family: "alerts", assistantErrorShape: "string", available: alertToolsAvailable, handler: listHandler,
};

/** Mặt lệnh gõ («cần xử lý»): cùng lõi, mô hình không thấy. */
const commandList: ToolDefinition<ListInput, PendingItemsResult> = {
  name: "alert_pending_list", title: "Tin cần xử lý (lệnh «cần xử lý»)", description: "Tin KHẨN / đang chờ trả lời trong phạm vi của người đang nhắn. Chỉ lệnh gõ.",
  input: () => listInput, output: listOutput, annotations: READ,
  surfaces: ["assistant_command"], family: "alerts", available: alertToolsAvailable, handler: listHandler,
};

export const PENDING_ITEMS_TOOLS: readonly AnyToolDefinition[] = [eraseTool(modelList), eraseTool(commandList)];
