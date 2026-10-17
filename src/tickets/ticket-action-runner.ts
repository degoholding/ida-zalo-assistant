import {
  acceptTicket, addTicketNote, cancelTicket, finishTicket, reopenTicket, TicketActionError, type TicketActor, type TicketDeps, type TicketRow,
} from "./ticket-service.js";

// Bảng «tên thao tác → hàm của ticket-service» dùng chung cho màn Ticket (POST /api/tickets/:id/actions) và công cụ ghi qua
// MCP / trợ lý (confirm_write). Nơi gọi tự kiểm quyền + phạm vi nhóm nguồn.

export const TICKET_ACTION_LABELS: Record<string, string> = { accept: "Nhận xử lý", done: "Báo xong", cancel: "Hủy", reopen: "Mở lại", note: "Nhắn người gửi" };

/** Chạy thao tác; trả câu mô tả cho `audit_log.message`. Chuyển trạng thái sai → `TicketActionError`. */
export async function runTicketAction(deps: TicketDeps, ticket: TicketRow, actor: TicketActor, action: string, note: string): Promise<string> {
  if (action === "accept") await acceptTicket(deps, ticket, actor);
  else if (action === "done") await finishTicket(deps, ticket, actor, note);
  else if (action === "cancel") await cancelTicket(deps, ticket, actor, note, false);
  else if (action === "reopen") await reopenTicket(deps, ticket, actor, note);
  else if (action === "note") await addTicketNote(deps, ticket, actor, note, { fromRequester: false });
  else throw new TicketActionError("Thao tác không hợp lệ.");
  return `${TICKET_ACTION_LABELS[action]} ${ticket.code}${note ? `: ${note.slice(0, 200)}` : ""}`;
}
