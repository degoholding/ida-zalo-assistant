import type { Db } from "../db/pool.js";
import { isBriefCommand, type BriefCommand } from "../briefs/brief-command-parser.js";
import { runBriefCommand, type BriefChatDeps } from "../briefs/brief-commands.js";
import { runTicketCommand, type TicketCommand, type TicketCommandContext } from "../tickets/ticket-commands.js";
import { isTaskCommandKind, type TaskCommand } from "../tasks/task-command-parser.js";
import { runTaskCommand, type TaskCommandContext } from "../tasks/task-commands.js";
import { GROUP_NOT_ALLOWED_REPLY, runSendChatCommand, type SendChatContext } from "../send-commands/send-command-chat.js";
import { isSendCommandKind, type SendChatCommand } from "../send-commands/send-command-parser.js";
import type { AskerAccess } from "./infra/asker-access.js";
import type { AlertAsker, AlertToolsDeps } from "./alert-tools.js";
import { runAlertChatCommand } from "./alert-chat-commands.js";
import { runCodedConfirmCancel, runPlainConfirmCancel } from "./chat-confirm-router.js";
import { buildHelpText } from "./chat-help-text.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";

// Lệnh gõ sẵn trong chat với bot (đại ca 08/10/2026: gõ «hướng dẫn» ra hướng dẫn cơ bản, có lệnh cấu hình luôn). Chạy TRƯỚC mô
// hình: trả lời ngay, không tốn token, không phụ thuộc AI hiểu đúng. Gõ có dấu hay không dấu đều nhận. Câu không khớp lệnh nào
// thì đi tiếp vào trợ lý AI như cũ. Tệp này chỉ giữ kiểu + bộ điều phối: đọc lệnh ở chat-command-parser.ts, hướng dẫn ở
// chat-help-text.ts, lệnh cảnh báo ở alert-chat-commands.ts, «đồng ý / hủy» ở chat-confirm-router.ts.

export { parseChatCommand } from "./chat-command-parser.js";
export { buildHelpText } from "./chat-help-text.js";

export type ChatCommand =
  | { kind: "help" }
  | { kind: "show_config" }
  | { kind: "list_pending" }
  | { kind: "mark_done"; messageId: number }
  | { kind: "keyword"; add: boolean; level: "urgent" | "important"; keyword: string }
  | { kind: "wait_minutes"; vip: boolean; minutes: number }
  | { kind: "vip"; add: boolean; name: string }
  // `code` có khi gõ «đồng ý K7Q2MX» / «hủy K7Q2MX» — chỉ dùng cho nháp ghi dữ liệu của trợ lý (write-confirm-chat.ts)
  | { kind: "confirm"; code?: string }
  | { kind: "cancel"; code?: string }
  | TicketCommand
  | TaskCommand
  | BriefCommand
  | SendChatCommand;

/** Lệnh ticket (báo / xem / nhận / xong / hủy / bổ sung) — người chưa có vai trò cũng dùng được (src/tickets/). */
export const isTicketCommand = (command: ChatCommand | null): command is TicketCommand => Boolean(command?.kind.startsWith("ticket_"));

/** Lệnh việc (phase 7: «việc», «xong V-12», «giao Minh: …») — người phụ trách chưa có vai trò cũng dùng được (quyền kiểm theo việc). */
export const isTaskCommand = (command: ChatCommand | null): command is TaskCommand => isTaskCommandKind(command?.kind);

/** Lệnh gửi tin theo lệnh (phase 9: «gửi nhóm A: …», «lệnh gửi», «hủy G-12») — chỉ tin riêng, quyền kiểm ở src/send-commands/. */
export const isSendCommand = (command: ChatCommand | null): command is SendChatCommand => isSendCommandKind(command?.kind);

export interface ChatCommandContext {
  db: Db;
  /** Có = dịch vụ thật (cấu hình đọc từ alertTools.config); không có = chỉ còn «hướng dẫn» */
  alertTools?: AlertToolsDeps;
  /** null = người hỏi không có vai trò / không là người nhận */
  asker: AlertAsker | null;
  /** Hỏi trong nhóm (bot được gọi tên): chỉ có «hướng dẫn» và lệnh ticket, mọi lệnh khác để AI xử lý */
  inGroup: boolean;
  now: Date;
  /** Ticket: người hỏi + cuộc đang hỏi. Không có = không có lệnh ticket. */
  ticket?: TicketCommandContext;
  /** Việc (checklist): người hỏi + cuộc đang hỏi. Không có = không có lệnh việc. */
  task?: TaskCommandContext;
  /** Bản tin / báo cáo gọi tay (phase 8): không có = không có lệnh bản tin (chạy tiếp lệnh khác / mô hình AI). */
  brief?: BriefChatDeps;
  /** Lệnh gửi tin (phase 9): chỉ gắn ở tin riêng. Không có = không có lệnh gửi (câu rơi xuống trợ lý AI). */
  send?: SendChatContext;
  /** Người chỉ được dùng lệnh ticket (chưa có vai trò, không là người nhận) — «hướng dẫn» chỉ nói phần ticket */
  ticketOnly?: boolean;
  /** Ngữ cảnh truy cập của người hỏi (phân giải lười) — «cần xử lý» / «xong tin số …» lọc theo phạm vi nhóm + Mật. */
  access?: () => Promise<AskerAccess>;
  /** Đánh thức bộ chạy việc nền sau khi ghi (nháp ghi dữ liệu do trợ lý đề xuất báo Zalo qua hàng đợi). */
  wakeJobs?: () => void;
  /** Phiên MCP của lệnh (lười) cho «đồng ý» / «hủy» nháp ghi — xem write-confirm-chat.ts. */
  mcp?: () => Promise<AssistantMcpTurn | undefined>;
}

/** Chạy lệnh. null = không xử lý ở đây (để trợ lý AI trả lời). */
export async function runChatCommand(ctx: ChatCommandContext, command: ChatCommand): Promise<string | null> {
  if (command.kind === "help") {
    const ticketHandler = ctx.ticket ? await ctx.ticket.isHandler() : false;
    return buildHelpText(ctx.inGroup ? null : ctx.asker, ctx.inGroup, { ticketOnly: ctx.ticketOnly, ticketHandler, canSend: Boolean(ctx.send?.requester) && !ctx.inGroup });
  }
  if (isTicketCommand(command)) return ctx.ticket ? runTicketCommand(ctx.ticket, command, ctx.now) : null;
  if (isTaskCommand(command)) return ctx.task ? runTaskCommand(ctx.task, command, ctx.now) : null;
  // Bản tin / báo cáo: CHỈ tin riêng (lộ dữ liệu phạm vi / Mật ra nhóm) — kiểm ngay ở đây, không chờ cổng ticketOnly
  // bên dưới vì câu từ chối ("không phải người nhận") vẫn phải trả lời cả người không có vai trò nào.
  if (isBriefCommand(command)) return ctx.inGroup ? null : ctx.brief ? runBriefCommand(ctx.brief, ctx.asker, command, ctx.now) : null;
  // Lệnh gửi: trong nhóm không nhận (câu cố định, không tạo nháp); tin riêng chạy ở src/send-commands/. Không có ngữ cảnh gửi → AI.
  if (isSendCommand(command)) return ctx.inGroup ? GROUP_NOT_ALLOWED_REPLY : ctx.send ? runSendChatCommand(command, ctx.send, ctx.now) : null;
  if (ctx.inGroup) return null;
  if (command.kind === "confirm" || command.kind === "cancel") {
    // Có mã → nháp ghi dữ liệu của trợ lý (D1: chỉ xác nhận ở đây, mô hình không có công cụ xác nhận); trơn → kho mới nhất
    return command.code !== undefined ? runCodedConfirmCancel(ctx, command.kind, command.code) : runPlainConfirmCancel(ctx, command.kind);
  }
  if (ctx.ticketOnly) return null;
  const { asker, alertTools: deps } = ctx;
  if (!asker || !deps) {
    return command.kind === "show_config" ? null : "Lệnh này dành cho quản lý / trưởng phòng / người nhận cảnh báo. Gõ «hướng dẫn» để xem bot làm được gì.";
  }
  return runAlertChatCommand(ctx, command, asker, deps);
}
