// Đường cũ của công cụ ticket (qua lệnh gõ cũ), dùng khi họ `tickets` tắt; không truy cập DB trực tiếp nên không cần dấu mcp-guard; gỡ ở phase 13
import { runTicketCommandLegacy, type TicketCommand, type TicketCommandContext } from "./ticket-commands-legacy.js";

// Công cụ ticket cho trợ lý AI (08/10/2026, đại ca: «đánh dấu nó là đã xong» mà bot báo «chưa có công cụ»). Câu tự nhiên
// → mô hình gọi công cụ → chạy ĐÚNG đường của lệnh gõ (runTicketCommandLegacy), nên luật quyền y hệt: nhận / xong chỉ người xử lý
// (người báo được tự đóng ticket của mình), xem chỉ người báo / người xử lý / quản lý.

export const TICKET_TOOL_ACTIONS = ["status", "accept", "done", "cancel", "note"] as const;
type TicketToolAction = (typeof TICKET_TOOL_ACTIONS)[number];

function toCommand(action: TicketToolAction, ticketId: number, note: string): TicketCommand {
  switch (action) {
    case "status": return { kind: "ticket_status", ticketId };
    case "accept": return { kind: "ticket_accept", ticketId };
    case "done": return { kind: "ticket_done", ticketId, note };
    case "cancel": return { kind: "ticket_cancel", ticketId, note };
    case "note": return { kind: "ticket_note", ticketId, note };
  }
}

export async function runTicketToolLegacy(ctx: TicketCommandContext | undefined, name: string, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  if (!ctx) return { error: "Ticket chưa bật ở bot này." };
  if (name === "list_tickets") return { result: await runTicketCommandLegacy(ctx, { kind: "ticket_list" }, now) };
  if (name === "create_ticket") {
    const text = String(args.text ?? "").trim();
    if (text.length < 3) return { error: "Thiếu nội dung ticket — hỏi lại người hỏi muốn báo gì." };
    return { result: await runTicketCommandLegacy(ctx, { kind: "ticket_create", text: text.slice(0, 3000) }, now) };
  }
  const ticketId = Number(args.ticket_id);
  const action = String(args.action ?? "") as TicketToolAction;
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return { error: "Thiếu số ticket (T-0012 → 12)." };
  if (!TICKET_TOOL_ACTIONS.includes(action)) return { error: "Việc không hợp lệ." };
  const note = String(args.note ?? "").trim().slice(0, 2000);
  if (action === "note" && !note) return { error: "Thiếu nội dung bổ sung." };
  return { result: await runTicketCommandLegacy(ctx, toCommand(action, ticketId, note), now) };
}
