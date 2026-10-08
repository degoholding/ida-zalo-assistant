import { TicketStatus } from "../constants.js";
import {
  acceptTicket, addTicketNote, cancelTicket, createTicket, describeTicket, describeTicketLine, findTicket, finishTicket,
  isTicketHandler, listOpenTickets, listRequesterTickets, TicketActionError, type TicketActor, type TicketDeps, type TicketRow,
} from "./ticket-service.js";

// Lệnh ticket gõ trên Zalo (đọc ở src/assistant/chat-commands.ts). Ai làm được gì:
// - Mọi người nhắn được cho bot (kể cả khách) hoặc gọi bot trong nhóm: báo ticket, xem ticket của mình, bổ sung, hủy hoặc tự báo xong ticket
//   mình báo.
// - Người xử lý (bảng ticket_handler, sửa trên màn Ticket): xem ticket đang mở, nhận, xong, hủy, nhắn người gửi.

export type TicketCommand =
  | { kind: "ticket_create"; text: string }
  | { kind: "ticket_list" }
  | { kind: "ticket_status"; ticketId: number }
  | { kind: "ticket_accept"; ticketId: number }
  | { kind: "ticket_done"; ticketId: number; note: string }
  | { kind: "ticket_cancel"; ticketId: number; note: string }
  | { kind: "ticket_note"; ticketId: number; note: string };

export interface TicketCommandContext {
  deps: TicketDeps;
  /** role = ContactRole (Quản lý / Trưởng phòng xem được mọi ticket, như người xử lý) */
  contact: { id: number; uid: string; name: string; role?: number };
  /** Cuộc đang nhắn (tin riêng / nhóm) và tin chứa lệnh — để gắn ảnh vừa gửi, báo lại đúng chỗ */
  threadId: number | null;
  messageId: number | null;
  botAccountId: number | null;
  /** Người này có là người xử lý ticket không (hỏi DB một lần / lượt) */
  isHandler: () => Promise<boolean>;
}

/** Dựng ngữ cảnh ticket cho một lượt hỏi. */
export function buildTicketContext(deps: TicketDeps, input: Omit<TicketCommandContext, "deps" | "isHandler">): TicketCommandContext {
  let cached: Promise<boolean> | null = null;
  return { deps, ...input, isHandler: () => (cached ??= isTicketHandler(deps.db, input.contact.uid)) };
}

const NOT_FOUND = (id: number) => `Em không thấy ticket T-${id} của anh/chị. Nhắn «ticket» để xem danh sách.`;

export async function runTicketCommand(ctx: TicketCommandContext, command: TicketCommand, now: Date): Promise<string> {
  const { deps, contact } = ctx;
  const actor: TicketActor = { name: contact.name, contactId: contact.id, via: "zalo" };
  if (command.kind === "ticket_create") {
    const result = await createTicket(deps, {
      requesterContactId: contact.id, requesterUid: contact.uid, requesterName: contact.name, sourceThreadId: ctx.threadId,
      sourceMessageId: ctx.messageId, botAccountId: ctx.botAccountId, text: command.text, now,
    });
    const short = `T-${result.ticket.id}`;
    return [
      `Dạ em đã ghi nhận ticket ${result.ticket.code}${result.attachmentCount ? ` (kèm ${result.attachmentCount} ảnh / tệp)` : ""}` +
        (result.handlerCount ? " và đã báo người xử lý." : "; hiện chưa cài người xử lý — em đã lưu, quản trị sẽ xem trên màn Ticket."),
      `Nhắn «${short}» để xem tình hình, «${short}: <nội dung>» để bổ sung (gửi thêm ảnh trước rồi nhắn).`,
    ].join("\n");
  }

  const handler = await ctx.isHandler();
  // Quản lý / Trưởng phòng: xem mọi ticket (danh sách đang mở, tình hình) — nhận / xong vẫn chỉ người xử lý
  const overseer = handler || (contact.role ?? 0) > 0;
  if (command.kind === "ticket_list") {
    if (overseer) {
      const open = await listOpenTickets(deps.db);
      if (!open.length) return "Hiện không có ticket nào đang mở.";
      return [`TICKET ĐANG MỞ (${open.length})`, ...open.map(describeTicketLine), "", "Nhắn «nhận T-12» / «xong T-12 <ghi chú>»."].join("\n");
    }
    const mine = await listRequesterTickets(deps.db, contact.uid);
    if (!mine.length) return "Anh/chị chưa báo ticket nào. Báo bằng cách nhắn «báo lỗi: <nội dung>».";
    return [`TICKET CỦA ANH/CHỊ (${mine.length} gần nhất)`, ...mine.map(describeTicketLine)].join("\n");
  }

  const ticket = await findTicket(deps.db, command.ticketId);
  const isRequester = Boolean(ticket && ticket.requester_uid === contact.uid);
  if (!ticket || (!isRequester && !overseer)) return NOT_FOUND(command.ticketId);

  try {
    switch (command.kind) {
      case "ticket_status":
        return describeTicket(ticket);
      case "ticket_accept":
        if (!handler) return "Chỉ người xử lý ticket mới nhận được. Quản trị thêm người xử lý ở màn Ticket.";
        await acceptTicket(deps, ticket, actor);
        return `Dạ anh/chị đã nhận ${ticket.code}; em đã báo ${ticket.requester_name}. Xong thì nhắn «xong T-${ticket.id} <ghi chú>».`;
      case "ticket_done":
        // Người gửi tự báo xong (lỗi tự hết / tự xử lý được) → đóng, báo người xử lý
        if (!handler && !isRequester) return "Chỉ người xử lý ticket (hoặc chính người báo) mới báo xong được.";
        if (!handler) {
          await finishTicket(deps, ticket, actor, command.note, true);
          return `Dạ em đã đóng ${ticket.code} theo báo của anh/chị. Còn vấn đề thì nhắn «T-${ticket.id}: <nội dung>» để mở lại.`;
        }
        await finishTicket(deps, ticket, actor, command.note);
        return `Dạ đã đóng ${ticket.code} và báo ${ticket.requester_name}.`;
      case "ticket_cancel":
        await cancelTicket(deps, ticket, actor, command.note, isRequester && !handler);
        return `Dạ đã hủy ${ticket.code}.`;
      case "ticket_note": {
        const fromRequester = isRequester;
        const result = await addTicketNote(deps, ticket, actor, command.note, { fromRequester, threadId: ctx.threadId, messageId: ctx.messageId, now });
        if (!fromRequester) return `Dạ em đã chuyển lời nhắn tới ${ticket.requester_name}.`;
        return `Dạ em đã thêm vào ${ticket.code}${result.attachmentCount ? ` (kèm ${result.attachmentCount} ảnh / tệp)` : ""}` +
          `${result.reopened ? " và MỞ LẠI ticket" : ""}; người xử lý sẽ nhận được.`;
      }
    }
  } catch (error) {
    if (error instanceof TicketActionError) return error.message;
    throw error;
  }
}

/** Cho bài kiểm / gợi ý: ticket còn mở không. */
export const isOpenTicket = (ticket: TicketRow) => ticket.status === TicketStatus.New || ticket.status === TicketStatus.InProgress;
