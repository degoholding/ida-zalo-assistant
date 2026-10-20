import { ticketRelationship, type TicketAction } from "../actors/contact-relationship-rules.js";
import type { ContactActor } from "../actors/contact-actor.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { andParts, sourceThreadVisibilitySql } from "../visibility-guards.js";
import { describeTicketLine, findTicket, listOpenTickets, listRequesterTickets, type TicketRow } from "../../tickets/ticket-service.js";
import { isTicketVisible } from "../../tickets/ticket-visibility.js";
import type { SqlPart } from "../../web/api/list-query.js";

// Luật ticket của liên hệ Zalo, phần HỎI DỮ LIỆU (quyết định thuần nằm ở actors/contact-relationship-rules.ts): ai là sếp / người xử lý, ticket nào
// người này thấy (nhóm nguồn + Mật), nạp ticket kèm quyết định. Chép đúng `runTicketCommand` cũ (src/tickets/ticket-commands-legacy.ts) — test vàng
// (test/assistant-mcp-tickets.integration.test.ts) so câu trả lời cũ / mới trên ma trận vai × thao tác × tin riêng / nhóm.

export const TICKET_ACTOR_REQUIRED = "Thao tác ticket cần người đang nhắn bot trên Zalo.";

/** Chủ thể của lượt; thiếu = lời gọi không đến từ tin Zalo (HTTP không bao giờ có). */
export function requireTicketActor(ctx: DataAccessContext): ContactActor {
  if (!ctx.contactActor) throw new DataAccessError("forbidden", TICKET_ACTOR_REQUIRED);
  return ctx.contactActor;
}

/** Hỏi trong nhóm: chỉ ticket của đúng nhóm đó (cột `t.source_thread_id`); tin riêng = không giới hạn. */
export function groupScopePartOf(actor: Pick<ContactActor, "groupId">): SqlPart | undefined {
  return actor.groupId ? { sql: "t.source_thread_id = ?", params: [actor.groupId] } : undefined;
}

/**
 * Điều kiện cho người xem ticket CỦA NGƯỜI KHÁC (bảng `ticket t` + LEFT JOIN `zalo_group g`). Tài khoản web (và tài khoản đã tắt) đi qua luật
 * nhóm + Mật của lõi; người chỉ suy từ vai trò / người nhận giữ phạm vi «mọi nhóm» nhưng KHÔNG thấy ticket của nhóm Mật.
 */
export function overseerVisibilityPart(ctx: DataAccessContext, actor: ContactActor): SqlPart | undefined {
  const accountScoped = actor.origin === "web_user" || actor.origin === "disabled_account";
  const source = accountScoped
    ? sourceThreadVisibilitySql(ctx, "t.source_thread_id", "g")
    : ctx.includeConfidential ? undefined : { sql: "(g.id IS NULL OR g.is_confidential = 0)", params: [] };
  return andParts(groupScopePartOf(actor), source);
}

export interface TicketListing {
  mode: "open" | "mine";
  lines: string[];
}

/** «ticket» / `list_tickets`: sếp thấy ticket đang mở (tối đa 20), người khác thấy ticket mình đã báo (10 gần nhất). */
export async function listTicketsForActor(ctx: DataAccessContext): Promise<TicketListing> {
  const actor = requireTicketActor(ctx);
  if (await actor.facts.isTicketOverseer()) {
    const open = await listOpenTickets(ctx.db, 20, overseerVisibilityPart(ctx, actor));
    return { mode: "open", lines: open.map(describeTicketLine) };
  }
  const mine = await listRequesterTickets(ctx.db, actor.uid, 10, groupScopePartOf(actor));
  return { mode: "mine", lines: mine.map(describeTicketLine) };
}

export type TicketDenyReasonCode = "not_found" | "handler_only" | "handler_or_requester";

export interface TicketTarget {
  ticket: TicketRow;
  isRequester: boolean;
  isHandler: boolean;
  /** Người báo tự thao tác (không phải người xử lý): đóng / hủy theo báo của chính họ. */
  asRequester: boolean;
}

/**
 * Nạp ticket + quyết định cho `action`. Không đủ quyền → `not_allowed` kèm `reason` máy đọc được (lớp lệnh dựng đúng câu cũ); lý do «không thấy»
 * dùng chung cho ticket không có, của người khác, ngoài nhóm, hay nhóm Mật — không lộ «có mà không được xem».
 */
export async function loadTicketForActor(ctx: DataAccessContext, ticketId: number, action: TicketAction): Promise<TicketTarget> {
  const actor = requireTicketActor(ctx);
  const ticket = await findTicket(ctx.db, ticketId);
  const deny = (reason: TicketDenyReasonCode) => new DataAccessError("not_allowed", `Không đủ quyền với ticket T-${ticketId} (${reason}).`, undefined, { reason });
  if (!ticket) throw deny("not_found");
  const isRequester = ticket.requester_uid === actor.uid;
  // Người báo luôn thấy ticket của mình; người khác còn phải qua luật nhóm + Mật (cùng luật danh sách)
  const visibleToOverseer = isRequester || await isTicketVisible(ctx.db, ticket.id, overseerVisibilityPart(ctx, actor));
  const decision = await ticketRelationship(actor, { requesterUid: ticket.requester_uid, sourceThreadId: ticket.source_thread_id, visibleToOverseer }, action);
  if (!decision.ok) throw deny(decision.reason);
  return { ticket, isRequester: decision.isRequester, isHandler: decision.isHandler, asRequester: decision.asRequester };
}
