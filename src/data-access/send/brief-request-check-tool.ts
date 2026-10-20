import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { BRIEF_CHAT_RATE_CAP_PER_HOUR, isPeriodicBrief } from "../../briefs/brief-command-support.js";
import { BriefTrigger, ContactRole } from "../../constants.js";
import { findRecipient } from "../../recipients/recipient-repository.js";
import { actorFactMemo } from "../actors/contact-actor.js";
import type { DataAccessContext } from "../data-access-context.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";

// Công cụ lệnh `brief_request_check` (họ `send`, mặt `assistant_command`): phần TRA DỮ LIỆU của lệnh «bản tin sáng», «báo cáo tuần»… gọi tay — người hỏi có là người nhận
// đang bật không, trần gọi tay / giờ trên `brief_log`. Dựng + gửi bản tin (thu thập, điểm tin AI, PDF / Excel, hàng đợi Zalo) là pipeline hệ thống, ở NGOÀI MCP
// (gửi cho chính người nhận; có thể chứa dữ liệu nhiều nhóm theo `recipient_group` — không phải đọc của người hỏi). Danh tính từ `contactActor`.
// Thứ tự kiểm = đường cũ: không phải người nhận → (thiếu lịch, do nơi gọi báo) → vượt trần.

const inputSchema = z.object({ request: z.enum(["morning", "evening", "auto", "weekly", "monthly"]), calendar_available: z.boolean() }).strict();
const recipientSchema = z.object({
  id: z.number(), tenant_id: z.number(), contact_id: z.number(), zalo_uid: z.string(), name: z.string(), title: z.string(), rank_order: z.number(),
  all_groups: z.number(), morning_brief_at: z.string(), evening_brief_at: z.string(), notify_urgent: z.number(), is_active: z.number(),
});
const outputSchema = z.object({ outcome: z.enum(["ok", "not_recipient", "no_calendar", "rate_limited", "passthrough"]), recipient: recipientSchema.optional() });
type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

/** Người nhận đang bật của người hỏi (theo mã Zalo); null = không phải. Nhớ theo lượt. */
function activeRecipientId(ctx: DataAccessContext): Promise<number | null> {
  return actorFactMemo(ctx, "brief:recipient", async () => {
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      "SELECT r.id FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE c.zalo_uid = ? AND r.is_active = 1 LIMIT 1", [ctx.contactActor!.uid]);
    return rows[0] ? Number(rows[0].id) : null;
  });
}

async function checkRequest(ctx: DataAccessContext, input: Input): Promise<Output> {
  const actor = ctx.contactActor!;
  // Tài khoản web gắn với liên hệ đã tắt: không suy đặc quyền từ vai trò / người nhận (như resolveAlertAsker)
  const disabled = actor.origin === "disabled_account";
  const recipientId = disabled ? null : await activeRecipientId(ctx);
  if (!recipientId) {
    // Báo cáo tuần / tháng là số liệu CHUNG: ai có vai trò đều xuất được qua `export_report` nên để lệnh khác / mô hình xử lý tiếp
    return { outcome: isPeriodicBrief(input.request) && !disabled && actor.contactRole !== ContactRole.None ? "passthrough" : "not_recipient" };
  }
  const recipient = await findRecipient(ctx.db, recipientId);
  if (!recipient || !recipient.is_active) return { outcome: "not_recipient" };
  if (!input.calendar_available) return { outcome: "no_calendar" };
  const [rows] = await ctx.db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM brief_log WHERE recipient_id = ? AND trigger_source = ? AND created_at > ?",
    [recipientId, BriefTrigger.Chat, new Date(ctx.now.getTime() - 3_600_000)],
  );
  if (Number(rows[0]?.n ?? 0) >= BRIEF_CHAT_RATE_CAP_PER_HOUR) return { outcome: "rate_limited" };
  return { outcome: "ok", recipient };
}

const briefRequestCheck: ToolDefinition<Input, Output> = {
  name: "brief_request_check", title: "Kiểm lệnh gọi bản tin / báo cáo tay",
  description: "Người hỏi có là người nhận đang bật không và đã chạm trần gọi tay / giờ chưa (trả cả hàng người nhận để dựng bản tin). Chỉ lệnh gõ / mã phía trợ lý.",
  input: () => inputSchema, output: outputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"], family: "send", available: (ctx) => ctx.contactActor !== undefined,
  async handler(ctx, input) {
    const result = await checkRequest(ctx, input);
    return { structured: result, summary: `Kiểm bản tin: ${result.outcome}`, rowCount: result.outcome === "ok" ? 1 : 0, entity: "recipient" };
  },
};

export const BRIEF_CHECK_TOOLS: readonly AnyToolDefinition[] = [eraseTool(briefRequestCheck)];
