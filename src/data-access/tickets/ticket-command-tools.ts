import { z } from "zod/v4";
import { executeImmediateWrite } from "../write/immediate-write.js";
import { eraseAction } from "../write/write-action.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { describeTicket } from "../../tickets/ticket-service.js";
import { actReply, createdReply, failureReply } from "../../tickets/ticket-command-replies.js";
import { TICKET_TOOL_DECLARATIONS } from "../../tickets/ticket-tools.js";
import { listTicketsForActor, loadTicketForActor } from "./ticket-actor-rules.js";
import { ticketOutcomeOf, ticketRelationshipCreate, ticketRelationshipUpdate, type TicketWriteOutcome } from "./ticket-relationship-write-actions.js";

// Công cụ của họ `tickets`. Mặt `assistant_command` (lệnh gõ — mô hình không thấy): trả KẾT QUẢ CÓ CẤU TRÚC, lớp lệnh (src/tickets/ticket-commands.ts)
// dựng câu. Mặt `assistant_model` (tên + khai báo giữ nguyên): cùng lõi nhưng trả `{ result: "<câu>" }` y như công cụ cũ — lỗi quyền / trạng thái
// cũng là câu trả lời, không phải lỗi công cụ. Mọi ghi chạy NGAY (BC1 bỏ); danh tính từ `ctx.contactActor`, không từ tham số.
// `list_tickets` (không tham số) CHƯA lên mặt mô hình: bộ làm sạch sơ đồ của cầu nối (`sanitizeForGemini`) từ chối OBJECT rỗng nên khai báo bị bỏ và
// mô hình mất công cụ; nó giữ đường cũ (ticket-tools-legacy.ts) cho tới khi cầu nối cho phép sơ đồ rỗng — phần lõi (`listTicketsForActor`) đã sẵn.

const createWrite = eraseAction(ticketRelationshipCreate);
const updateWrite = eraseAction(ticketRelationshipUpdate);

const hasActor = (ctx: DataAccessContext): boolean => ctx.contactActor != null;
/**
 * Công cụ MÔ HÌNH chỉ lên khi bot có ticket: đường cũ khai báo chúng khi cấu hình có `tickets` (hàng đợi báo Zalo), và assistant-service chỉ gắn
 * `wakeJobs` vào ngữ cảnh trong trường hợp đó. Thiếu → mô hình không thấy công cụ (như hôm nay), lệnh gõ không bị ảnh hưởng (nơi gọi đã có ngữ cảnh ticket).
 */
const ticketsConfigured = (ctx: DataAccessContext): boolean => hasActor(ctx) && ctx.wakeJobs != null;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const };

const emptyInput = z.object({}).strict();
const ticketIdInput = z.object({ ticket_id: z.number().int().positive() }).strict();
const createInput = z.object({ text: z.string().min(3) }).strict();
const actInput = z.object({ ticket_id: z.number().int().positive(), action: z.enum(["accept", "done", "cancel", "note"]), note: z.string().optional() }).strict();

const listOutput = z.object({ mode: z.enum(["open", "mine"]), lines: z.array(z.string()) });
const getOutput = z.object({ ticket_id: z.number(), code: z.string(), description: z.string() });
const writeOutput = z.object({
  outcome: z.enum(["created", "accepted", "closed_by_handler", "closed_by_requester", "cancelled", "note_sent", "note_added"]),
  ticket_id: z.number(), code: z.string(), requester_name: z.string().optional(), attachment_count: z.number().optional(),
  handler_count: z.number().optional(), reopened: z.boolean().optional(), download_ids: z.array(z.number()),
});
const resultOutput = z.object({ result: z.string() });

type ActInput = z.infer<typeof actInput>;
type Outcome<T> = Promise<{ structured: T; summary: string; rowCount: number; entity: string }>;

const asOutcome = <T>(structured: T, summary: string, rowCount = 1) => ({ structured, summary, rowCount, entity: "ticket" });
const runWrite = async (ctx: DataAccessContext, action: typeof createWrite, args: unknown): Promise<TicketWriteOutcome> =>
  ticketOutcomeOf(await executeImmediateWrite(ctx, action, args));

async function describeOne(ctx: DataAccessContext, ticketId: number) {
  const { ticket } = await loadTicketForActor(ctx, ticketId, "status");
  return { ticket_id: ticket.id, code: ticket.code, description: describeTicket(ticket) };
}

// ------------------------------------------------------------------ mặt lệnh gõ

const commandBase = { surfaces: ["assistant_command"] as const, family: "tickets" as const, available: hasActor };

const listForActor: ToolDefinition<Record<string, never>, z.infer<typeof listOutput>> = {
  ...commandBase, name: "ticket_list_for_actor", title: "Danh sách ticket của người đang nhắn (lệnh «ticket»)",
  description: "Sếp / người xử lý: ticket đang mở; người khác: ticket mình đã báo. Chỉ lệnh gõ.",
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>, output: listOutput, annotations: READ,
  async handler(ctx): Outcome<z.infer<typeof listOutput>> {
    const listing = await listTicketsForActor(ctx);
    return asOutcome(listing, `${listing.lines.length} ticket`, listing.lines.length);
  },
};

const getTicket: ToolDefinition<z.infer<typeof ticketIdInput>, z.infer<typeof getOutput>> = {
  ...commandBase, name: "ticket_get", title: "Xem một ticket (lệnh «T-12»)",
  description: "Tình hình một ticket theo luật quan hệ (người báo / người xử lý / sếp; trong nhóm chỉ ticket của nhóm). Chỉ lệnh gõ.",
  input: () => ticketIdInput, output: getOutput, annotations: READ,
  async handler(ctx, input): Outcome<z.infer<typeof getOutput>> {
    const found = await describeOne(ctx, input.ticket_id);
    return asOutcome(found, `Ticket ${found.code}`);
  },
};

const createCommand: ToolDefinition<z.infer<typeof createInput>, z.infer<typeof writeOutput>> = {
  ...commandBase, name: "ticket_create", title: "Báo ticket mới (lệnh «báo lỗi: …»)",
  description: "Báo ticket mới cho người đang nhắn; chạy ngay (lệnh gõ = xác nhận). Chỉ lệnh gõ.",
  input: () => createInput, output: writeOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof writeOutput>> {
    const outcome = await runWrite(ctx, createWrite, input);
    return asOutcome(outcome, `Đã ghi nhận ticket ${outcome.code}`);
  },
};

const actCommand: ToolDefinition<ActInput, z.infer<typeof writeOutput>> = {
  ...commandBase, name: "ticket_act", title: "Thao tác ticket (lệnh «nhận / xong / hủy T-12», «T-12: …»)",
  description: "Nhận / báo xong / hủy / bổ sung MỘT ticket theo luật quan hệ; chạy ngay (lệnh gõ = xác nhận). Chỉ lệnh gõ.",
  input: () => actInput, output: writeOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof writeOutput>> {
    const outcome = await runWrite(ctx, updateWrite, input);
    return asOutcome(outcome, `Ticket ${outcome.code}: ${outcome.outcome}`);
  },
};

// ------------------------------------------------------------------ mặt mô hình

const modelBase = { surfaces: ["assistant_model"] as const, family: "tickets" as const, assistantErrorShape: "string" as const, available: ticketsConfigured };
const declaration = (name: string) => {
  const found = TICKET_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!found) throw new Error(`thiếu khai báo công cụ ticket ${name}`);
  return found.description;
};

/** Lỗi quyền / trạng thái → CÂU TRẢ LỜI (công cụ cũ trả `{ result: <câu> }`); lỗi khác ném tiếp. */
function asReply(error: unknown, ticketId: number | null): { result: string } {
  if (error instanceof DataAccessError) {
    const reply = failureReply({ code: error.code, message: error.message, reason: error.detail?.reason }, ticketId);
    if (reply !== null) return { result: reply };
  }
  throw error;
}

const modelCreateTicket: ToolDefinition<{ text: string }, z.infer<typeof resultOutput>> = {
  ...modelBase, name: "create_ticket", title: "Tạo ticket", description: declaration("create_ticket"),
  input: () => z.object({ text: z.string() }), output: resultOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof resultOutput>> {
    const text = input.text.trim();
    if (text.length < 3) throw new DataAccessError("invalid_value", "Thiếu nội dung ticket — hỏi lại người hỏi muốn báo gì.");
    const outcome = await runWrite(ctx, createWrite, { text: text.slice(0, 3000) });
    return asOutcome({ result: createdReply(outcome as Extract<TicketWriteOutcome, { outcome: "created" }>) }, `Đã ghi nhận ticket ${outcome.code}`);
  },
};

const modelActInput = z.object({
  ticket_id: z.number().int(),
  action: z.enum(["status", "accept", "done", "cancel", "note"]),
  note: z.string().optional().describe("Ghi chú / lý do / nội dung bổ sung (tùy việc)"),
});

const modelTicketAction: ToolDefinition<z.infer<typeof modelActInput>, z.infer<typeof resultOutput>> = {
  ...modelBase, name: "ticket_action", title: "Thao tác một ticket", description: declaration("ticket_action"),
  input: () => modelActInput, output: resultOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof resultOutput>> {
    if (!Number.isSafeInteger(input.ticket_id) || input.ticket_id <= 0) throw new DataAccessError("invalid_value", "Thiếu số ticket (T-0012 → 12).");
    const note = (input.note ?? "").trim().slice(0, 2000);
    if (input.action === "note" && !note) throw new DataAccessError("invalid_value", "Thiếu nội dung bổ sung.");
    try {
      if (input.action === "status") return asOutcome({ result: (await describeOne(ctx, input.ticket_id)).description }, `Ticket T-${input.ticket_id}`);
      const outcome = await runWrite(ctx, updateWrite, { ticket_id: input.ticket_id, action: input.action, note });
      return asOutcome({ result: actReply(outcome as Parameters<typeof actReply>[0]) }, `Ticket ${outcome.code}: ${outcome.outcome}`);
    } catch (error) {
      return asOutcome(asReply(error, input.ticket_id), `Ticket T-${input.ticket_id}: không thực hiện được`, 0);
    }
  },
};

export const TICKET_FAMILY_TOOLS: readonly AnyToolDefinition[] = [
  eraseTool(modelTicketAction), eraseTool(modelCreateTicket),
  eraseTool(listForActor), eraseTool(getTicket), eraseTool(createCommand), eraseTool(actCommand),
];
