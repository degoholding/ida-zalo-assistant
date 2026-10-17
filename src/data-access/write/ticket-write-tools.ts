import { z } from "zod/v4";
import { runTicketAction } from "../../tickets/ticket-action-runner.js";
import { TICKET_STATUS_LABELS, type TicketActor, type TicketRow } from "../../tickets/ticket-service.js";
import { recordAudit } from "../../web/api/audit-log.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import type { WriteAction } from "./write-action.js";
import { assertNoMaskedText } from "./write-input-guards.js";
import { STALE_MESSAGE } from "./write-row-lock.js";
import { loadVisibleTicket } from "./write-target-guards.js";

// Ticket: nhận xử lý / xong / hủy / mở lại / nhắn người gửi — qua ticket-service (bot báo người gửi + người xử lý như trên Zalo / web).

const ACTIONS = ["accept", "finish", "cancel", "reopen", "note"] as const;
const ACTION_TEXT: Record<(typeof ACTIONS)[number], string> = { accept: "Nhận xử lý", finish: "Báo xong", cancel: "Hủy", reopen: "Mở lại", note: "Nhắn người gửi" };

const schema = z.object({
  ticket_id: z.number().int().positive(),
  action: z.enum(ACTIONS).describe("accept = nhận xử lý; finish = báo xong; cancel = hủy; reopen = mở lại; note = nhắn người gửi (cần note)."),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, issue) => {
  if (value.action === "note" && !value.note) issue.addIssue({ code: "custom", path: ["note"], message: "note cần nội dung nhắn" });
});
type Input = z.infer<typeof schema>;

const stateOf = (ticket: TicketRow) => `${ticket.status}|${ticket.handler_contact_id ?? ""}`;
const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;
const actorOf = (ctx: DataAccessContext): TicketActor => ({ name: ctx.principal.fullName || ctx.principal.email, contactId: null, via: "web" });

export const ticketAction: WriteAction<Input> = {
  tool: "propose_ticket_action",
  title: "Đề xuất thao tác ticket",
  description: "Đề xuất một thao tác lên ticket ĐÃ CÓ: nhận xử lý, báo xong, hủy, mở lại, nhắn người gửi. Người gửi được báo qua Zalo khi xác nhận.",
  entity: "ticket",
  schema,
  async prepare(ctx, input) {
    assertNoMaskedText(ctx, { note: input.note });
    const ticket = await loadVisibleTicket(ctx, input.ticket_id);
    const preview = `Ticket ${ticket.code} ${quote(ticket.title)} (${TICKET_STATUS_LABELS[ticket.status]}): ${ACTION_TEXT[input.action]}${input.note ? ` — ${quote(input.note)}` : ""}`;
    return { preview, targetEntity: "ticket", targetId: ticket.id, stateToken: stateOf(ticket) };
  },
  async execute(ctx, input, expectedState) {
    assertNoMaskedText(ctx, { note: input.note });
    const ticket = await loadVisibleTicket(ctx, input.ticket_id);
    // ticket-service còn UPDATE kèm «trạng thái như lúc đọc»; đây là lớp kiểm thêm cho người xử lý đổi sát lúc ghi (M1)
    if (stateOf(ticket) !== expectedState) throw new DataAccessError("stale_target", STALE_MESSAGE);
    const message = await runTicketAction({ db: ctx.db, wakeJobs: ctx.wakeJobs }, ticket, actorOf(ctx), input.action === "finish" ? "done" : input.action, input.note ?? "");
    await recordAudit(ctx.db, { entity: "ticket", entityId: ticket.id, action: "update", message });
    return { entity: "ticket", id: ticket.id, changed: [ACTION_TEXT[input.action]], message };
  },
};
