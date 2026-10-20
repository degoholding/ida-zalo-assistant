import { z } from "zod/v4";
import { ticketActorOf } from "../actors/contact-relationship-rules.js";
import type { WriteAction, WriteExecuted } from "../write/write-action.js";
import { acceptTicket, addTicketNote, cancelTicket, createTicket, finishTicket, TICKET_STATUS_LABELS, type TicketDeps } from "../../tickets/ticket-service.js";
import type { TicketActOutcome, TicketCreatedResult } from "../../tickets/ticket-command-replies.js";
import { loadTicketForActor, requireTicketActor } from "./ticket-actor-rules.js";

// Hai thao tác ghi theo QUAN HỆ của liên hệ Zalo (O3): người đang nhắn bot báo ticket mới / nhận / báo xong / hủy / bổ sung ticket. GHI NGAY
// (`confirmMode: "immediate"`, BC1 bỏ): lệnh gõ = xác nhận, và ghi do mô hình khởi xướng giữ như hôm nay. `prepare` = luật quan hệ (không đủ quyền
// → `not_allowed` + lý do); `execute` đi qua ticket-service (báo Zalo qua hàng đợi việc nền — gửi thật ở ngoài).

const ACTION_LABELS = { accept: "Nhận xử lý", done: "Báo xong", cancel: "Hủy", note: "Nhắn / bổ sung" } as const;
const firstLine = (text: string) => text.split(/\r?\n/)[0].trim().slice(0, 120);
const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;

/** Kết quả có cấu trúc kèm các tệp đã đưa về hàng tải (lớp ngoài mới có bộ tải) — tách khỏi `WriteExecuted` qua WeakMap, không đổi kiểu dùng chung. */
export type TicketWriteOutcome = (TicketCreatedResult | TicketActOutcome) & { download_ids: number[] };
const OUTCOMES = new WeakMap<WriteExecuted, TicketWriteOutcome>();

export function ticketOutcomeOf(executed: WriteExecuted): TicketWriteOutcome {
  const outcome = OUTCOMES.get(executed);
  if (!outcome) throw new Error("thiếu kết quả có cấu trúc của thao tác ticket");
  return outcome;
}

function executed(outcome: TicketWriteOutcome, label: string, changed: string): WriteExecuted {
  const result: WriteExecuted = { entity: "ticket", id: outcome.ticket_id, changed: [changed], message: `${label} ${outcome.code}` };
  OUTCOMES.set(result, outcome);
  return result;
}

/** `requestDownload` của ticket-service không có ở lõi: gom id lại, lớp lệnh gõ chuyển cho bộ tải. */
function depsWithDownloads(ctx: { db: TicketDeps["db"]; wakeJobs?: () => void }): { deps: TicketDeps; downloads: number[] } {
  const downloads: number[] = [];
  return { deps: { db: ctx.db, wakeJobs: ctx.wakeJobs, requestDownload: (ids) => { downloads.push(...ids); } }, downloads };
}

const createSchema = z.object({ text: z.string().trim().min(3).describe("Mô tả ticket; dòng đầu là tiêu đề.") }).strict();

export const ticketRelationshipCreate: WriteAction<z.infer<typeof createSchema>> = {
  tool: "ticket_relationship_create",
  title: "Báo ticket mới (người đang nhắn bot)",
  description: "Người đang nhắn bot báo một ticket mới; ảnh / tệp họ vừa gửi trong 15 phút gắn vào ticket.",
  entity: "ticket",
  permission: "relationship",
  confirmMode: "immediate",
  schema: createSchema,
  async prepare(ctx, input) {
    requireTicketActor(ctx);
    return { preview: `Báo ticket mới ${quote(firstLine(input.text))}`, targetEntity: "ticket", targetId: null, stateToken: "" };
  },
  async execute(ctx, input) {
    const actor = requireTicketActor(ctx);
    const { deps, downloads } = depsWithDownloads(ctx);
    const result = await createTicket(deps, {
      requesterContactId: actor.contactId, requesterUid: actor.uid, requesterName: actor.name, sourceThreadId: actor.threadId,
      sourceMessageId: actor.messageId, botAccountId: actor.botAccountId, text: input.text, now: ctx.now,
    });
    return executed({ outcome: "created", ticket_id: result.ticket.id, code: result.ticket.code, attachment_count: result.attachmentCount,
      handler_count: result.handlerCount, download_ids: downloads }, "Báo ticket", "Báo ticket mới");
  },
};

const updateSchema = z.object({
  ticket_id: z.number().int().positive(),
  action: z.enum(["accept", "done", "cancel", "note"]),
  note: z.string().optional(),
}).strict();

export const ticketRelationshipUpdate: WriteAction<z.infer<typeof updateSchema>> = {
  tool: "ticket_relationship_update",
  title: "Thao tác ticket theo quan hệ (người đang nhắn bot)",
  description: "Người xử lý nhận / báo xong / hủy / nhắn người báo; người báo tự đóng / hủy / bổ sung ticket của mình. Luật quan hệ kiểm ở `prepare`.",
  entity: "ticket",
  permission: "relationship",
  confirmMode: "immediate",
  schema: updateSchema,
  async prepare(ctx, input) {
    const { ticket } = await loadTicketForActor(ctx, input.ticket_id, input.action);
    const note = input.note?.trim();
    return {
      preview: `Ticket ${ticket.code} ${quote(ticket.title)} (${TICKET_STATUS_LABELS[ticket.status]}): ${ACTION_LABELS[input.action]}${note ? ` — ${quote(note)}` : ""}`,
      targetEntity: "ticket", targetId: ticket.id, stateToken: `${ticket.status}|${ticket.handler_contact_id ?? ""}`,
    };
  },
  async execute(ctx, input) {
    const actor = ticketActorOf(requireTicketActor(ctx));
    const { ticket, isRequester, isHandler, asRequester } = await loadTicketForActor(ctx, input.ticket_id, input.action);
    const { deps, downloads } = depsWithDownloads(ctx);
    const note = input.note?.trim() ?? "";
    const base = { ticket_id: ticket.id, code: ticket.code };
    const label = ACTION_LABELS[input.action];
    // ticket-service còn UPDATE kèm «trạng thái như lúc đọc»: hai người thao tác cùng lúc thì người sau nhận câu «vừa được người khác cập nhật»
    switch (input.action) {
      case "accept":
        await acceptTicket(deps, ticket, actor);
        return executed({ ...base, outcome: "accepted", requester_name: ticket.requester_name, download_ids: downloads }, label, label);
      case "done":
        // Người báo (không phải người xử lý) tự báo xong → đóng, báo người xử lý
        await finishTicket(deps, ticket, actor, note, !isHandler);
        return executed(isHandler
          ? { ...base, outcome: "closed_by_handler", requester_name: ticket.requester_name, download_ids: downloads }
          : { ...base, outcome: "closed_by_requester", download_ids: downloads }, label, label);
      case "cancel":
        await cancelTicket(deps, ticket, actor, note, asRequester);
        return executed({ ...base, outcome: "cancelled", download_ids: downloads }, label, label);
      case "note": {
        const added = await addTicketNote(deps, ticket, actor, note, { fromRequester: isRequester, threadId: ctx.contactActor?.threadId, messageId: ctx.contactActor?.messageId, now: ctx.now });
        return executed(isRequester
          ? { ...base, outcome: "note_added", attachment_count: added.attachmentCount, reopened: added.reopened, download_ids: downloads }
          : { ...base, outcome: "note_sent", requester_name: ticket.requester_name, download_ids: downloads }, label, label);
      }
    }
  },
};
