import { z } from "zod/v4";
import { TaskSource } from "../../constants.js";
import { taskActorOf } from "../actors/contact-relationship-rules.js";
import type { DataAccessContext } from "../data-access-context.js";
import { loadUserPrincipal } from "../../auth/principal.js";
import { contactScopeSql } from "../../web/api/scope.js";
import { contactScopeOf } from "../reads/contact-scope-of-actor.js";
import { requireOnePerson, type PersonResolveOptions } from "../resolvers/person-name-resolver.js";
import { requireDueText, requireDueTextStrict } from "../resolvers/due-text-resolver.js";
import type { WriteAction } from "../write/write-action.js";
import type { TaskActOutcome, TaskCreatedResult } from "../../tasks/task-command-replies.js";
import { formatDue, TASK_STATUS_LABELS } from "../../tasks/task-format.js";
import { shortTaskCode, type TaskParty } from "../../tasks/task-repository.js";
import {
  addTaskNote, cancelTask, confirmTask, createTask, finishTask, reassignTask, rejectTask, reopenTask, rescheduleTask, type TaskDeps, type TaskDue,
} from "../../tasks/task-service.js";
import { assertMayAssign, denyTask, loadTaskForActor, requireTaskActor } from "./task-actor-rules.js";
import { executedTask } from "./task-write-outcomes.js";

// Hai thao tác ghi việc theo QUAN HỆ của liên hệ Zalo (O3): người đang nhắn bot giao việc mới / xong / ghi chú / dời hạn / giao lại / hủy / mở lại /
// xác nhận / bỏ đề xuất. GHI NGAY (`confirmMode: "immediate"`, BC1 bỏ): lệnh gõ = xác nhận, và ghi do mô hình khởi xướng giữ như hôm nay.
// `prepare` = luật quan hệ + phân giải người / hạn (không đủ quyền → `not_allowed` + lý do; tên mơ hình → `ambiguous` / `not_found`); `execute` đi qua
// task-service (báo Zalo qua hàng đợi việc nền — gửi thật ở ngoài). Thứ tự kiểm CHÉP đúng đường cũ: quyền → hạn → người.

/**
 * Tùy chọn tìm người: ưu tiên nhóm / cuộc đang nhắn; tài khoản web chỉ chọn được người trong PHẠM VI Danh bạ của TÀI KHOẢN (như màn Danh bạ — L2) — hỏi trong nhóm thì
 * principal của lượt đã bị thu về đúng nhóm đó nên nạp lại phạm vi gốc của tài khoản. Người chỉ suy từ vai trò / người nhận giữ cách tìm cũ (cả Danh bạ) để không đổi lệnh gõ hôm nay.
 */
export async function personResolveOptions(ctx: DataAccessContext, actor: { origin: string; groupId: number | null; threadId: number | null }): Promise<PersonResolveOptions> {
  const groupId = actor.groupId ?? actor.threadId;
  if (actor.origin !== "web_user") return { groupId, scope: null };
  if (actor.groupId === null || ctx.principal.userId === null) return { groupId, scope: contactScopeOf(ctx) };
  const account = await loadUserPrincipal(ctx.db, ctx.principal.userId);
  return { groupId, scope: account ? contactScopeSql(account) : contactScopeOf(ctx) };
}

const quote = (text: string) => `«${text.replace(/\s+/g, " ").slice(0, 200)}»`;
const taskDeps = (ctx: DataAccessContext): TaskDeps => ({ db: ctx.db, wakeJobs: ctx.wakeJobs });

const createSchema = z.object({
  title: z.string().min(1),
  assignee_name: z.string().min(1).describe("Tên người làm như người hỏi gọi."),
  due_text: z.string().optional().describe("Hạn: chữ («thứ 6», «mai 17h») hoặc ISO 8601."),
  /** TaskPriority (1 cao, 2 TB, 3 thấp). */
  priority: z.number().int().min(1).max(3).optional(),
  /** TaskSource (1 lệnh gõ, 2 trợ lý). */
  source: z.number().int().min(1).max(4).optional(),
}).strict();
type CreateInput = z.infer<typeof createSchema>;

async function planCreate(ctx: DataAccessContext, input: CreateInput): Promise<{ due: TaskDue | null; assignee: TaskParty }> {
  const actor = requireTaskActor(ctx);
  await assertMayAssign(actor);
  const due = requireDueText(input.due_text, ctx.now);
  const person = await requireOnePerson(ctx.db, input.assignee_name, "giao <tên>: <việc> hạn <ngày>", await personResolveOptions(ctx, actor));
  return { due: due && { at: due.at, hasTime: due.hasTime }, assignee: { contactId: person.id, uid: person.uid, name: person.name } };
}

export const taskRelationshipCreate: WriteAction<CreateInput> = {
  tool: "task_relationship_create",
  title: "Giao việc mới (người đang nhắn bot)",
  description: "Người đang nhắn bot giao một việc mới cho người trong Danh bạ (tìm theo tên); người phụ trách được báo qua Zalo.",
  entity: "task",
  permission: "relationship",
  confirmMode: "immediate",
  schema: createSchema,
  async prepare(ctx, input) {
    const { due, assignee } = await planCreate(ctx, input);
    return {
      preview: `Giao việc ${quote(input.title)} — ${assignee.name} — hạn ${formatDue(due?.at ?? null, due?.hasTime ?? false, ctx.now)}`,
      targetEntity: "task", targetId: null, stateToken: "",
    };
  },
  async execute(ctx, input) {
    const actor = requireTaskActor(ctx);
    const { due, assignee } = await planCreate(ctx, input);
    const task = (await createTask(taskDeps(ctx), {
      title: input.title, assignee, assigner: taskActorOf(actor), source: input.source ?? TaskSource.Command, priority: input.priority,
      sourceThreadId: actor.threadId, sourceMessageId: actor.messageId, due, via: "zalo",
    }))!;
    const outcome: TaskCreatedResult = {
      outcome: "created", code: shortTaskCode(task), title: task.title, assignee_name: assignee.name,
      due_label: formatDue(task.due_at, task.due_has_time, ctx.now), has_due: due !== null, notified: assignee.uid !== actor.uid,
    };
    return executedTask(outcome, task.id, `Giao việc ${task.code}`, "Giao việc mới");
  },
};

export const TASK_UPDATE_ACTIONS = ["done", "note", "reschedule", "reassign", "cancel", "reopen", "confirm", "reject"] as const;
type UpdateAction = (typeof TASK_UPDATE_ACTIONS)[number];
const ACTION_LABELS: Record<UpdateAction, string> = {
  done: "Báo xong", note: "Ghi chú", reschedule: "Dời hạn", reassign: "Giao lại", cancel: "Hủy", reopen: "Mở lại", confirm: "Lưu đề xuất", reject: "Bỏ đề xuất",
};

const updateSchema = z.object({
  task_id: z.number().int().positive(),
  action: z.enum(TASK_UPDATE_ACTIONS),
  note: z.string().optional(),
  due_text: z.string().optional(),
  assignee_name: z.string().optional(),
}).strict();
type UpdateInput = z.infer<typeof updateSchema>;

/** Nạp việc, kiểm quyền theo thao tác (xong / ghi chú: người liên quan; còn lại: người giao hoặc «sếp»), phân giải hạn mới / người mới. */
async function planUpdate(ctx: DataAccessContext, input: UpdateInput) {
  const actor = requireTaskActor(ctx);
  const { task, decision } = await loadTaskForActor(ctx, input.task_id);
  if (input.action === "done" && !decision.canWork) throw denyTask("work_done");
  if (input.action === "note" && !decision.canWork) throw denyTask("work_note");
  if (input.action !== "done" && input.action !== "note" && !decision.canManage) throw denyTask("manage_only");
  const due = input.action === "reschedule" ? requireDueTextStrict(input.due_text, ctx.now) : null;
  const code = shortTaskCode(task);
  const person = input.action === "reassign"
    ? await requireOnePerson(ctx.db, input.assignee_name ?? "", `giao lại ${code} <tên>`, await personResolveOptions(ctx, actor))
    : null;
  const assignee: TaskParty | null = person && { contactId: person.id, uid: person.uid, name: person.name };
  return { actor, task, code, due, assignee };
}

export const taskRelationshipUpdate: WriteAction<UpdateInput> = {
  tool: "task_relationship_update",
  title: "Thao tác việc theo quan hệ (người đang nhắn bot)",
  description: "Người phụ trách / người giao / quản lý báo xong, ghi chú; người giao / quản lý dời hạn, giao lại, hủy, mở lại, lưu hoặc bỏ đề xuất. Luật quan hệ kiểm ở `prepare`.",
  entity: "task",
  permission: "relationship",
  confirmMode: "immediate",
  schema: updateSchema,
  async prepare(ctx, input) {
    const { task, due, assignee } = await planUpdate(ctx, input);
    const detail = [due ? `hạn mới ${formatDue(due.at, due.hasTime, ctx.now)}` : "", assignee ? `giao cho ${quote(assignee.name)}` : "", input.note?.trim() ? `ghi chú ${quote(input.note.trim())}` : ""].filter(Boolean);
    return {
      preview: `Việc ${task.code} ${quote(task.title)} (${TASK_STATUS_LABELS[task.status]}): ${ACTION_LABELS[input.action]}${detail.length ? ` — ${detail.join("; ")}` : ""}`,
      // Gồm cả người / hạn đã PHÂN GIẢI từ chữ (D-A: nháp chờ «đồng ý»): danh bạ / «mai 17h» đổi giữa lúc đề xuất và xác nhận thì báo lạc hậu, không giao nhầm người
      targetEntity: "task", targetId: task.id,
      stateToken: `${task.status}|${task.due_at?.toISOString() ?? ""}|${task.assignee?.contactId ?? task.assignee?.name ?? ""}|${due?.at.toISOString() ?? ""}|${assignee?.contactId ?? ""}`,
    };
  },
  async execute(ctx, input) {
    const { actor, task, code, due, assignee } = await planUpdate(ctx, input);
    const who = taskActorOf(actor);
    const deps = taskDeps(ctx);
    const note = input.note ?? "";
    const done = (outcome: TaskActOutcome) => executedTask(outcome, task.id, `${ACTION_LABELS[input.action]} ${task.code}`, ACTION_LABELS[input.action]);
    // task-service còn UPDATE kèm «trạng thái như lúc đọc»: hai người thao tác cùng lúc thì người sau nhận câu «vừa được cập nhật»
    switch (input.action) {
      case "done":
        await finishTask(deps, task, who, note);
        return done({ outcome: "done", code, notified_name: task.assigner.uid && task.assigner.uid !== actor.uid ? task.assigner.name : null });
      case "note":
        await addTaskNote(deps, task, who, note);
        return done({ outcome: "noted", code });
      case "reschedule": {
        const updated = await rescheduleTask(deps, task, who, due!);
        return done({ outcome: "rescheduled", code, due_label: formatDue(updated.due_at, updated.due_has_time, ctx.now) });
      }
      case "reassign":
        await reassignTask(deps, task, who, assignee!);
        return done({ outcome: "reassigned", code, assignee_name: assignee!.name });
      case "cancel":
        await cancelTask(deps, task, who, note);
        return done({ outcome: "cancelled", code });
      case "reopen":
        await reopenTask(deps, task, who, note);
        return done({ outcome: "reopened", code });
      case "confirm": {
        const confirmed = await confirmTask(deps, task, who);
        return done({ outcome: "confirmed", code, notified_name: confirmed.assignee?.uid ? confirmed.assignee.name : null });
      }
      case "reject":
        await rejectTask(deps, task, who);
        return done({ outcome: "rejected", code });
    }
  },
};
