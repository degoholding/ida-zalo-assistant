import type { TaskActor, TaskParty } from "../../tasks/task-repository.js";
import type { TicketActor } from "../../tickets/ticket-service.js";
import type { ContactActor } from "./contact-actor.js";

// Luật «ai làm được gì theo QUAN HỆ» của liên hệ Zalo (O3) — CHÉP ĐÚNG từ `src/tasks/task-permissions.ts` (việc) và `src/tickets/ticket-commands.ts`
// (ticket). Hàm thuần nhận chủ thể + sự thật đã hỏi + bản ghi; phần hỏi DB nằm ở `contact-actor.ts` (facts lười). Test vàng
// (`test/assistant-contact-actor.integration.test.ts`) so quyết định cũ / mới trên ma trận vai × quan hệ × cuộc — sửa luật ở đây là sửa cả hai nơi
// cho tới khi đường cũ bị gỡ (phase 13).

/** Nhãn người ghi trên nhật ký việc / ticket: «làm trên Zalo», đúng như lệnh gõ hôm nay. */
export const taskActorOf = (actor: ContactActor): TaskActor => ({ contactId: actor.contactId, uid: actor.uid, name: actor.name, via: "zalo" });
export const ticketActorOf = (actor: ContactActor): TicketActor => ({ name: actor.name, contactId: actor.contactId, via: "zalo" });

// ---------------------------------------------------------------- Việc

export interface TaskRelationInput {
  assigner: TaskParty | null;
  assignee: TaskParty | null;
  /** Nhóm nguồn của việc (`task.source_thread_id`). */
  sourceThreadId: number | null;
}

export interface TaskRelationDecision {
  isAssigner: boolean;
  isAssignee: boolean;
  /** Xem. Trong nhóm: chỉ việc của chính nhóm đó. */
  canView: boolean;
  /** Đánh xong / ghi chú. */
  canWork: boolean;
  /** Dời hạn, giao lại, hủy, mở lại, xác nhận / bỏ đề xuất. */
  canManage: boolean;
}

type ActorIdentity = Pick<ContactActor, "uid" | "contactId" | "groupId">;

const isParty = (actor: ActorIdentity, party: TaskParty | null): boolean =>
  Boolean(party && ((party.uid && party.uid === actor.uid) || party.contactId === actor.contactId));

/** `overseer` = «sếp» (sự thật `isTaskOverseer`): vai trò Danh bạ hoặc người nhận đang bật; tài khoản web đã tắt thì không. */
export function decideTaskRelationship(actor: ActorIdentity, overseer: boolean, task: TaskRelationInput): TaskRelationDecision {
  const isAssigner = isParty(actor, task.assigner);
  const isAssignee = isParty(actor, task.assignee);
  const involved = overseer || isAssigner || isAssignee;
  const canView = actor.groupId !== null ? task.sourceThreadId === actor.groupId : involved;
  return { isAssigner, isAssignee, canView, canWork: canView && involved, canManage: canView && (overseer || isAssigner) };
}

export async function taskRelationship(actor: ContactActor, task: TaskRelationInput): Promise<TaskRelationDecision> {
  return decideTaskRelationship(actor, await actor.facts.isTaskOverseer(), task);
}

// ---------------------------------------------------------------- Ticket

export type TicketAction = "status" | "accept" | "done" | "cancel" | "note";

export interface TicketRelationInput {
  /** `ticket.requester_uid`. */
  requesterUid: string;
  /** `ticket.source_thread_id`. */
  sourceThreadId: number | null;
  /**
   * Người xem ticket CỦA NGƯỜI KHÁC còn phải qua luật nhóm + Mật (`overseerPart` / `isTicketVisible`) — nơi gọi tự tính; người báo luôn thấy ticket
   * của mình.
   */
  visibleToOverseer: boolean;
}

export type TicketDenyReason = "not_found" | "handler_only" | "handler_or_requester";

export type TicketDecision =
  | { ok: true; isRequester: boolean; isHandler: boolean; /** Người báo tự thao tác (không phải người xử lý): đóng / hủy theo báo của chính họ. */ asRequester: boolean }
  | { ok: false; reason: TicketDenyReason };

/** Quyết định cho MỘT ticket đã có (không gồm «báo mới» / «danh sách» — ai cũng báo được). `handler` / `overseer` lấy từ facts. */
export function decideTicketRelationship(
  actor: Pick<ContactActor, "uid" | "groupId">, facts: { handler: boolean; overseer: boolean }, ticket: TicketRelationInput, action: TicketAction,
): TicketDecision {
  const isRequester = ticket.requesterUid === actor.uid;
  if (!isRequester && !facts.overseer) return { ok: false, reason: "not_found" };
  // Trong nhóm: chỉ ticket của nhóm này (cả người báo lẫn người xử lý)
  if (actor.groupId && ticket.sourceThreadId !== actor.groupId) return { ok: false, reason: "not_found" };
  if (!isRequester && !ticket.visibleToOverseer) return { ok: false, reason: "not_found" };
  if (action === "accept" && !facts.handler) return { ok: false, reason: "handler_only" };
  if (action === "done" && !facts.handler && !isRequester) return { ok: false, reason: "handler_or_requester" };
  return { ok: true, isRequester, isHandler: facts.handler, asRequester: isRequester && !facts.handler };
}

export async function ticketRelationship(actor: ContactActor, ticket: TicketRelationInput, action: TicketAction): Promise<TicketDecision> {
  const [handler, overseer] = await Promise.all([actor.facts.isTicketHandler(), actor.facts.isTicketOverseer()]);
  return decideTicketRelationship(actor, { handler, overseer }, ticket, action);
}
