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

const createSchema = z.object({
  title: z.string().trim().min(1).max(300).describe("Nội dung việc."),
  assignee_contact_id: z.number().int().positive().optional().describe("Id Danh bạ người phụ trách (tra bằng query_records, entity contacts)."),
  due_date: DATE.optional().describe("Hạn, giờ Việt Nam."),
  due_time: TIME.optional().describe("Giờ hạn; cần kèm due_date."),
  source_thread_id: z.number().int().positive().optional().describe("Id nhóm / cuộc nguồn của việc."),
}).strict();
type CreateInput = z.infer<typeof createSchema>;

const UPDATE_ACTIONS = ["finish", "reopen", "cancel", "reschedule", "reassign", "note"] as const;
const updateSchema = z.object({
  task_id: z.number().int().positive(),
  action: z.enum(UPDATE_ACTIONS).describe("finish = báo xong; reopen = mở lại; cancel = hủy; reschedule = dời hạn (cần due_date); reassign = giao lại (cần assignee_contact_id); note = ghi chú (cần note)."),
  note: NOTE.optional(),
  due_date: DATE.optional(),
  due_time: TIME.optional(),
  assignee_contact_id: z.number().int().positive().optional(),
}).strict().superRefine((value, issue) => {
  const need = (ok: boolean, path: string, message: string) => { if (!ok) issue.addIssue({ code: "custom", path: [path], message }); };
  need(value.action !== "reschedule" || Boolean(value.due_date), "due_date", "reschedule cần due_date");
  need(value.action !== "reassign" || value.assignee_contact_id !== undefined, "assignee_contact_id", "reassign cần assignee_contact_id");
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

function dueOf(ctx: DataAccessContext, date: string | undefined, time: string | undefined): TaskDue | null {
  return parseTaskDueInput(date, time, ctx.now);
}

export const taskCreateAction: WriteAction<CreateInput> = {
  tool: "propose_task_create",
  title: "Đề xuất tạo việc",
  description: "Đề xuất TẠO một việc mới (giao việc) trong checklist; người phụ trách được báo qua Zalo khi xác nhận.",
  entity: "task",
  schema: createSchema,
  async prepare(ctx, input) {
    assertNoMaskedText(ctx, { title: input.title });
    const due = dueOf(ctx, input.due_date, input.due_time);
    const assignee = input.assignee_contact_id === undefined ? null : await partyOf(ctx, input.assignee_contact_id);
    if (input.source_thread_id !== undefined) await assertThreadReadable(ctx, input.source_thread_id);
    const parts = [`Tạo việc ${quote(input.title)}`, `phụ trách: ${assignee ? quote(assignee.name) : "chưa có"}`, `hạn: ${formatDue(due?.at ?? null, due?.hasTime ?? false, ctx.now)}`];
    if (input.source_thread_id !== undefined) parts.push(`nhóm nguồn #${input.source_thread_id}`);
    return { preview: parts.join(" — "), targetEntity: "task", targetId: null, stateToken: "new" };
  },
  async execute(ctx, input) {
    assertNoMaskedText(ctx, { title: input.title });
    const due = dueOf(ctx, input.due_date, input.due_time);
    const assignee = input.assignee_contact_id === undefined ? null : await partyOf(ctx, input.assignee_contact_id);
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
  const due = input.action === "reschedule" ? dueOf(ctx, input.due_date, input.due_time) : null;
  const assignee = input.action === "reassign" ? await partyOf(ctx, input.assignee_contact_id!) : null;
  const detail = [due ? `hạn mới ${formatDue(due.at, due.hasTime, ctx.now)}` : "", assignee ? `giao cho ${quote(assignee.name)}` : "", input.note ? `ghi chú ${quote(input.note)}` : ""].filter(Boolean);
  const preview = `Việc ${task.code} ${quote(task.title)} (${TASK_STATUS_LABELS[task.status]}): ${ACTION_TEXT[input.action]}${detail.length ? ` — ${detail.join("; ")}` : ""}`;
  return { due, assignee, preview };
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
    const { preview } = await describeUpdate(ctx, input, task);
    return { preview, targetEntity: "task", targetId: task.id, stateToken: stateOf(task) };
  },
  async execute(ctx, input, expectedState) {
    assertNoMaskedText(ctx, { note: input.note });
    const task = await loadVisibleTask(ctx, input.task_id);
    // task-service còn UPDATE có điều kiện trạng thái; đây là lớp kiểm thêm cho hạn / người phụ trách / tên việc đổi sát lúc ghi (M1)
    if (stateOf(task) !== expectedState) throw new DataAccessError("stale_target", STALE_MESSAGE);
    const { due, assignee } = await describeUpdate(ctx, input, task);
    const runnerAction = input.action === "finish" ? "done" : input.action;
    const message = await runTaskAction(taskDeps(ctx), task, actorOf(ctx), runnerAction, { note: input.note ?? "", due, assignee });
    await recordAudit(ctx.db, { entity: "task", entityId: task.id, action: "update", message });
    return { entity: "task", id: task.id, changed: [ACTION_TEXT[input.action]], message };
  },
};
