import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { alertRuntimeOf, alertToolsAvailable, requireAlertAsker } from "./alert-asker-facts.js";

// «cấu hình» (lệnh gõ): cài đặt cảnh báo đang chạy + phần RIÊNG của người nhận (nhóm theo dõi, VIP). Chỉ mặt lệnh gõ; lớp lệnh dựng câu từ kết quả
// có cấu trúc (src/assistant/alert-chat-commands.ts). Danh sách rút gọn như bản cũ: 11 nhóm / 31 VIP lấy (lớp lệnh hiển thị 10 / 30 rồi «…»).

const settingsSchema = z.object({
  enabled: z.boolean(), aiEnabled: z.boolean(), urgentKeywords: z.string(), importantKeywords: z.string(), strictKeywords: z.string(),
  replyWaitMinutes: z.number(), vipWaitMinutes: z.number(), dailyReminderCap: z.number(), urgentMergeSeconds: z.number(), workHours: z.string(), quietHours: z.string(),
});
const outputSchema = z.object({
  settings: settingsSchema,
  own: z.object({ all_groups: z.boolean(), groups: z.array(z.string()), vips: z.array(z.string()) }).nullable(),
});
type Output = z.infer<typeof outputSchema>;
const emptyInput = z.object({}).strict();

const view: ToolDefinition<Record<string, never>, Output> = {
  name: "alert_config_view", title: "Xem cấu hình cảnh báo (lệnh «cấu hình»)",
  description: "Cài đặt cảnh báo đang chạy + nhóm theo dõi và VIP của người đang nhắn (nếu là người nhận). Chỉ lệnh gõ.",
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>, output: outputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"], family: "alerts", available: alertToolsAvailable,
  async handler(ctx: DataAccessContext) {
    const asker = await requireAlertAsker(ctx);
    const runtime = alertRuntimeOf(ctx);
    if (!runtime) throw new DataAccessError("invalid_state", "Bot chưa bật cảnh báo qua trợ lý.");
    let own: Output["own"] = null;
    if (asker.recipientId) {
      const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT all_groups FROM recipient WHERE id = ?", [asker.recipientId]);
      const [groups] = await ctx.db.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(g.label, ''), g.name) AS name FROM recipient_group rg JOIN zalo_group g ON g.id = rg.group_id
         WHERE rg.recipient_id = ? ORDER BY name LIMIT 11`, [asker.recipientId]);
      const [vips] = await ctx.db.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name FROM recipient_vip v JOIN contact c ON c.id = v.contact_id
         WHERE v.recipient_id = ? ORDER BY name LIMIT 31`, [asker.recipientId]);
      own = { all_groups: Boolean(rows[0]?.all_groups), groups: groups.map((row) => String(row.name)), vips: vips.map((row) => String(row.name)) };
    }
    return { structured: { settings: runtime.settings(), own }, summary: "Cấu hình cảnh báo", rowCount: 1, entity: "recipient" };
  },
};

export const ALERT_CONFIG_VIEW_TOOLS: readonly AnyToolDefinition[] = [eraseTool(view)];
