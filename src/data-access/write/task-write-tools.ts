import { z } from "zod/v4";
import { TaskSource } from "../../constants.js";
import { runTaskAction } from "../../tasks/task-action-runner.js";
import { formatDue, TASK_STATUS_LABELS } from "../../tasks/task-format.js";
import type { TaskActor, TaskParty, TaskRow } from "../../tasks/task-repository.js";
import { createTask, type TaskDeps, type TaskDue } from "../../tasks/task-service.js";
import { recordAudit } from "../../web/api/audit-log.js";
import { loadContactParty, parseTaskDueInput, resolveAssignerContactId } from "../../web/api/tasks-api.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { contactScopeOf } from "../reads/contact-scope-of-actor.js";
import { requireDueText } from "../resolvers/due-text-resolver.js";
import { requireOnePerson } from "../resolvers/person-name-resolver.js";
import { assertThreadReadable } from "../visibility-guards.js";
import type { WriteAction } from "./write-action.js";
import { assertNoMaskedText } from "./write-input-guards.js";
import { STALE_MESSAGE } from "./write-row-lock.js";
import { assertContactTarget, loadVisibleTask } from "./write-target-guards.js";

// Việc: tạo mới + thao tác (xong / mở lại / hủy / dời hạn / giao lại / ghi chú) — chạy qua task-service như màn Việc trên web / Zalo,
// nên người phụ trách vẫn được báo qua Zalo y như thao tác thường.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD");
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ dạng HH:mm");
const NOTE = z.string().trim().min(1).max(2000);

const ASSIGNEE_NAME = z.string().trim().min(1).max(100);
const DUE_TEXT = z.string().trim().min(1).max(100);

const createSchema = z.object({
  title: z.string().trim().min(1).max(300).describe("Nội dung việc."),
  assignee_contact_id: z.number().int().positive().optional().describe("Id Danh bạ người phụ trách (tra bằng query_records, entity contacts)."),
  assignee_name: ASSIGNEE_NAME.optional().describe("Hoặc tên người phụ trách (một người rõ ràng trong Danh bạ; trùng tên thì báo lỗi kèm danh sách). Không dùng cùng assignee_contact_id."),
  due_date: DATE.optional().describe("Hạn, giờ Việt Nam."),
  due_time: TIME.optional().describe("Giờ hạn; cần kèm due_date."),
  due_text: DUE_TEXT.optional().describe("Hoặc hạn bằng chữ («thứ 6», «mai 17h», «20/10») — hiểu theo giờ Việt Nam, bản xem trước ghi rõ ngày giờ cụ thể. Không dùng cùng due_date."),
  source_thread_id: z.number().int().positive().optional().describe("Id nhóm / cuộc nguồn của việc."),
}).strict().superRefine((value, issue) => {
  if (value.assignee_contact_id !== undefined && value.assignee_name !== undefined) issue.addIssue({ code: "custom", path: ["assignee_name"], message: "Chỉ dùng MỘT trong assignee_contact_id / assignee_name" });
  if ((value.due_date !== undefined || value.due_time !== undefined) && value.due_text !== undefined) issue.addIssue({ code: "custom", path: ["due_text"], message: "Chỉ dùng MỘT trong due_date(+due_time) / due_text" });
});
type CreateInput = z.infer<typeof createSchema>;
const usesText = (input: { due_text?: string; assignee_name?: string }): boolean => input.due_text !== undefined || input.assignee_name !== undefined;

const UPDATE_ACTIONS = ["finish", "reopen", "cancel", "reschedule", "reassign", "note"] as const;
const updateSchema = z.object({
  task_id: z.number().int().positive(),
  action: z.enum(UPDATE_ACTIONS).describe("finish = báo xong; reopen = mở lại; cancel = hủy; reschedule = dời hạn (cần due_date); reassign = giao lại (cần assignee_contact_id); note = ghi chú (cần note)."),
  note: NOTE.optional(),
  due_date: DATE.optional(),
  due_time: TIME.optional(),
  due_text: DUE_TEXT.optional().describe("Hạn mới bằng chữ («thứ 6», «mai 17h») thay cho due_date; theo giờ Việt Nam."),
  assignee_contact_id: z.number().int().positive().optional(),
  assignee_name: ASSIGNEE_NAME.optional().describe("Tên người phụ trách mới thay cho assignee_contact_id (một người rõ ràng trong Danh bạ)."),
}).strict().superRefine((value, issue) => {
  const need = (ok: boolean, path: string, message: string) => { if (!ok) issue.addIssue({ code: "custom", path: [path], message }); };
  need(value.action !== "reschedule" || Boolean(value.due_date) || value.due_text !== undefined, "due_date", "reschedule cần due_date hoặc due_text");
  need(value.action !== "reassign" || value.assignee_contact_id !== undefined || value.assignee_name !== undefined, "assignee_contact_id", "reassign cần assignee_contact_id hoặc assignee_name");
  need(value.assignee_contact_id === undefined || value.assignee_name === undefined, "assignee_name", "Chỉ dùng MỘT trong assignee_contact_id / assignee_name");
  need(!((value.due_date !== undefined || value.due_time !== undefined) && value.due_text !== undefined), "due_text", "Chỉ dùng MỘT trong due_date(+due_time) / due_text");
  need(value.action !== "note" || Boolean(value.note), "note", "note cần nội dung ghi chú");
});
type UpdateInput = z.infer<typeof updateSchema>;

const taskDeps = (ctx: DataAccessContext): TaskDeps => ({ db: ctx.db, wakeJobs: ctx.wakeJobs });
const actorOf = (ctx: DataAccessContext): TaskActor => ({ contactId: null, uid: null, name: ctx.principal.fullName || ctx.principal.email, via: "web" });
const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;

async function partyOf(ctx: DataAccessContext, contactId: number): Promise<TaskParty> {
  await assertContactTarget(ctx, contactId);
  return loadContactParty(ctx.db, contactId);
}

function dueOf(ctx: DataAccessContext, date: string | undefined, time: string | undefined, text?: string): TaskDue | null {
  if (text !== undefined) {
    const due = requireDueText(text, ctx.now);
    return due && { at: due.at, hasTime: due.hasTime };
  }
  return parseTaskDueInput(date, time, ctx.now);
}

/**
 * Người phụ trách theo id HOẶC theo tên: tên phải khớp đúng MỘT người trong phạm vi Danh bạ của người gọi (`contactScopeOf` — cổng ngoài theo principal;
 * trợ lý theo danh tính liên hệ), nhiều người → `ambiguous` kèm danh sách, không ai → `not_found`. Không đoán.
 */
async function assigneeOf(ctx: DataAccessContext, contactId: number | undefined, name: string | undefined, groupId?: number): Promise<TaskParty | null> {
  if (contactId !== undefined) return partyOf(ctx, contactId);
  if (name === undefined) return null;
  const person = await requireOnePerson(ctx.db, name, "assignee_name đầy đủ hơn (hoặc assignee_contact_id)", { groupId: groupId ?? null, scope: contactScopeOf(ctx) });
  return partyOf(ctx, person.id);
}

/**
 * Phần dấu trạng thái cho đầu vào bằng CHỮ (tên / hạn): kết quả phân giải lúc đề xuất. Xác nhận phân giải lại — khác (vd «17h» qua nửa đêm, danh bạ đổi) →
 * `stale_target` thay vì ghi điều người duyệt chưa thấy. Đầu vào dạng id / ngày cụ thể: rỗng (giữ nguyên dấu cũ).
 */
const resolvedToken = (usesText: boolean, due: TaskDue | null, assignee: TaskParty | null): string =>
  usesText ? `|${due?.at.toISOString() ?? ""}|${due?.hasTime ? 1 : 0}|${assignee?.contactId ?? ""}` : "";

export const taskCreateAction: WriteAction<CreateInput> = {
  tool: "propose_task_create",
  title: "Đề xuất tạo việc",
  description: "Đề xuất TẠO một việc mới (giao việc) trong checklist; người phụ trách được báo qua Zalo khi xác nhận.",
  entity: "task",
  schema: createSchema,
  async prepare(ctx, input) {
    assertNoMaskedText(ctx, { title: input.title });
    const due = dueOf(ctx, input.due_date, input.due_time, input.due_text);
    const assignee = await assigneeOf(ctx, input.assignee_contact_id, input.assignee_name, input.source_thread_id);
    if (input.source_thread_id !== undefined) await assertThreadReadable(ctx, input.source_thread_id);
    const parts = [`Tạo việc ${quote(input.title)}`, `phụ trách: ${assignee ? quote(assignee.name) : "chưa có"}`, `hạn: ${formatDue(due?.at ?? null, due?.hasTime ?? false, ctx.now)}`];
    if (input.source_thread_id !== undefined) parts.push(`nhóm nguồn #${input.source_thread_id}`);
    return { preview: parts.join(" — "), targetEntity: "task", targetId: null, stateToken: `new${resolvedToken(usesText(input), due, assignee)}` };
  },
  async execute(ctx, input, expectedState) {
    assertNoMaskedText(ctx, { title: input.title });
    const due = dueOf(ctx, input.due_date, input.due_time, input.due_text);
    const assignee = await assigneeOf(ctx, input.assignee_contact_id, input.assignee_name, input.source_thread_id);
    if (`new${resolvedToken(usesText(input), due, assignee)}` !== expectedState) throw new DataAccessError("stale_target", STALE_MESSAGE);
    if (input.source_thread_id !== undefined) await assertThreadReadable(ctx, input.source_thread_id);
    const assignerContactId = await resolveAssignerContactId(ctx.db, ctx.principal);
    const task = await createTask(taskDeps(ctx), {
      title: input.title, assignee, source: TaskSource.Assistant, sourceThreadId: input.source_thread_id ?? null, due, via: "web",
      assigner: { contactId: assignerContactId, uid: null, name: ctx.principal.fullName || ctx.principal.email },
    });
    if (!task) throw new DataAccessError("invalid_state", "Việc này đã có rồi.");
    await recordAudit(ctx.db, { entity: "task", entityId: task.id, action: "create", message: `Tạo việc ${task.code}: ${task.title}` });
    return { entity: "task", id: task.id, changed: ["Tạo mới"], message: `Đã tạo việc ${task.code}: ${task.title}` };
  },
};

const stateOf = (task: TaskRow) => [task.status, task.due_at?.toISOString() ?? "", task.assignee?.contactId ?? task.assignee?.name ?? "", task.title].join("|");

const ACTION_TEXT: Record<UpdateInput["action"], string> = {
  finish: "Báo xong", reopen: "Mở lại", cancel: "Hủy", reschedule: "Dời hạn", reassign: "Giao lại", note: "Ghi chú",
};

async function describeUpdate(ctx: DataAccessContext, input: UpdateInput, task: TaskRow) {
  const due = input.action === "reschedule" ? dueOf(ctx, input.due_date, input.due_time, input.due_text) : null;
  const assignee = input.action === "reassign" ? await assigneeOf(ctx, input.assignee_contact_id, input.assignee_name) : null;
  const detail = [due ? `hạn mới ${formatDue(due.at, due.hasTime, ctx.now)}` : "", assignee ? `giao cho ${quote(assignee.name)}` : "", input.note ? `ghi chú ${quote(input.note)}` : ""].filter(Boolean);
  const preview = `Việc ${task.code} ${quote(task.title)} (${TASK_STATUS_LABELS[task.status]}): ${ACTION_TEXT[input.action]}${detail.length ? ` — ${detail.join("; ")}` : ""}`;
  return { due, assignee, preview, token: resolvedToken(usesText(input), due, assignee) };
}

export const taskUpdateAction: WriteAction<UpdateInput> = {
  tool: "propose_task_update",
  title: "Đề xuất cập nhật việc",
  description: "Đề xuất một thao tác lên việc ĐÃ CÓ: báo xong, mở lại, hủy, dời hạn, giao lại, ghi chú. Các bên liên quan được báo qua Zalo khi xác nhận.",
  entity: "task",
  schema: updateSchema,
  async prepare(ctx, input) {
    assertNoMaskedText(ctx, { note: input.note });
    const task = await loadVisibleTask(ctx, input.task_id);
    const { preview, token } = await describeUpdate(ctx, input, task);
    return { preview, targetEntity: "task", targetId: task.id, stateToken: `${stateOf(task)}${token}` };
  },
  async execute(ctx, input, expectedState) {
    assertNoMaskedText(ctx, { note: input.note });
    const task = await loadVisibleTask(ctx, input.task_id);
    // task-service còn UPDATE có điều kiện trạng thái; đây là lớp kiểm thêm cho hạn / người phụ trách / tên việc đổi sát lúc ghi (M1)
    const { due, assignee, token } = await describeUpdate(ctx, input, task);
    if (`${stateOf(task)}${token}` !== expectedState) throw new DataAccessError("stale_target", STALE_MESSAGE);
    const runnerAction = input.action === "finish" ? "done" : input.action;
    const message = await runTaskAction(taskDeps(ctx), task, actorOf(ctx), runnerAction, { note: input.note ?? "", due, assignee });
    await recordAudit(ctx.db, { entity: "task", entityId: task.id, action: "update", message });
    return { entity: "task", id: task.id, changed: [ACTION_TEXT[input.action]], message };
  },
};
