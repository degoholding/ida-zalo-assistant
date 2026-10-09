import crypto from "node:crypto";
import type { ResultSetHeader } from "mysql2";
import { TaskEventKind, TaskPriority, TaskRemindStage, TaskSource, TaskStatus } from "../constants.js";
import type { MessageQueueDeps } from "../messaging/contact-message.js";
import { dueDeadline, formatDue, TASK_STATUS_LABELS } from "./task-format.js";
import { newTaskText, notifyTaskParty, otherParties } from "./task-notify.js";
import {
  findTask, formatTaskCode, recordTaskEvent, shortTaskCode, type TaskActor, type TaskParty, type TaskRow,
} from "./task-repository.js";

// Checklist công việc (phase 7, IDA câu 22–23). MỘT chỗ cho mọi thao tác — lệnh gõ / công cụ trợ lý trên Zalo
// (task-commands.ts, task-tools.ts) và màn Việc trên web (src/web/api/tasks-api.ts) đều gọi vào đây, nên làm ở đâu thì
// các bên cũng được báo như nhau. Ở đây chỉ kiểm chuyển trạng thái hợp lệ; ai được làm gì kiểm ở task-permissions.ts.
// Mọi lệnh đổi trạng thái kèm điều kiện «trạng thái vẫn như lúc đọc» (review 09/10/2026): hai người cùng bấm (xong / hủy,
// xác nhận / tự hết hạn) thì người sau nhận câu «vừa được cập nhật», không ai bị ghi đè, không báo tin đôi.

const TITLE_MAX = 300;
const OPEN_LIKE = [TaskStatus.Open, TaskStatus.Proposed];

export type TaskDeps = MessageQueueDeps;

export class TaskActionError extends Error {}

export interface TaskDue {
  at: Date;
  hasTime: boolean;
}

export interface CreateTaskInput {
  title: string;
  priority?: TaskPriority;
  assignee: TaskParty | null;
  assigner: TaskParty;
  source: TaskSource;
  sourceThreadId?: number | null;
  sourceMessageId?: number | null;
  due: TaskDue | null;
  /** true = đề xuất (AI bắt từ tin), chờ xác nhận — chưa báo người phụ trách */
  proposed?: boolean;
  /** true = không báo người phụ trách (nơi gọi tự báo gộp — vd lưu cả bảng phân công recap) */
  silent?: boolean;
  /** Chống tạo hai lần: «ai:<id tin>:1», «recap:<id tin>:<…>» — trùng thì không tạo (trả null) */
  dedupeKey?: string;
  via: TaskActor["via"];
}

const tag = (kind: string) => `${kind}:${Date.now()}`;
const dueText = (task: TaskRow) => formatDue(task.due_at, task.due_has_time);

/** Hạn đã qua lúc giao / dời thì coi như đã nhắc quá hạn — không bắn tin quá hạn cho cả 3 bên ngay sau khi giao. */
const initialStage = (due: TaskDue | null, now = new Date()) => {
  const deadline = due ? dueDeadline({ due_at: due.at, due_has_time: due.hasTime }) : null;
  return deadline && deadline.getTime() <= now.getTime() ? TaskRemindStage.Overdue : TaskRemindStage.None;
};

/** UPDATE kèm điều kiện trạng thái; không dòng nào khớp = người khác vừa đổi → TaskActionError. */
async function transition(deps: TaskDeps, task: TaskRow, from: TaskStatus[], set: string, params: unknown[], extraWhere = ""): Promise<TaskRow> {
  const [result] = await deps.db.query<ResultSetHeader>(`UPDATE task SET ${set} WHERE id = ? AND status IN (?) ${extraWhere}`, [...params, task.id, from]);
  if (result.affectedRows === 0) throw new TaskActionError(`${shortTaskCode(task)} vừa được cập nhật — nhắn «${shortTaskCode(task)}» để xem.`);
  return (await findTask(deps.db, task.id))!;
}

function requireStatus(task: TaskRow, allowed: TaskStatus[], what: string): void {
  if (!allowed.includes(task.status)) throw new TaskActionError(`${shortTaskCode(task)} ${TASK_STATUS_LABELS[task.status]} — ${what}.`);
}

/** Báo người phụ trách: có việc (mới / vừa được giao lại cho họ / vừa xác nhận). */
async function announceToAssignee(deps: TaskDeps, task: TaskRow, kind: string): Promise<void> {
  if (!task.assignee?.uid || task.assignee.uid === task.assigner.uid) return;
  await notifyTaskParty(deps, task, task.assignee, newTaskText(task), tag(kind));
}

/** Báo mọi bên trừ người đang thao tác. */
async function tellOthers(deps: TaskDeps, task: TaskRow, actor: TaskActor, text: string, kind: string): Promise<void> {
  for (const party of otherParties(task, actor)) await notifyTaskParty(deps, task, party, text, tag(kind));
}

export async function createTask(deps: TaskDeps, input: CreateTaskInput): Promise<TaskRow | null> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  if (!title) throw new TaskActionError("Thiếu nội dung việc.");
  let result: ResultSetHeader;
  try {
    [result] = await deps.db.query<ResultSetHeader>(
      `INSERT INTO task (code, status, priority, title, assignee_contact_id, assignee_uid, assignee_name, assigner_contact_id,
         assigner_uid, assigner_name, source, source_thread_id, source_message_id, dedupe_key, due_at, due_has_time, remind_stage, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`~${crypto.randomBytes(8).toString("hex")}`, input.proposed ? TaskStatus.Proposed : TaskStatus.Open, input.priority ?? TaskPriority.Normal,
        title, input.assignee?.contactId ?? null, input.assignee?.uid ?? null, (input.assignee?.name ?? "").slice(0, 255),
        input.assigner.contactId, input.assigner.uid, input.assigner.name.slice(0, 255), input.source, input.sourceThreadId ?? null,
        input.sourceMessageId ?? null, input.dedupeKey ?? null, input.due?.at ?? null, input.due?.hasTime ? 1 : 0, initialStage(input.due),
        input.proposed ? null : new Date()]);
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY" && input.dedupeKey) return null;
    throw error;
  }
  const id = result.insertId;
  await deps.db.query("UPDATE task SET code = ? WHERE id = ?", [formatTaskCode(id), id]);
  await recordTaskEvent(deps.db, id, TaskEventKind.Created, { name: input.assigner.name, via: input.via });
  const task = (await findTask(deps.db, id))!;
  if (!input.proposed && !input.silent) await announceToAssignee(deps, task, "new");
  return task;
}

/** Xác nhận đề xuất → việc chính thức, báo người phụ trách. */
export async function confirmTask(deps: TaskDeps, task: TaskRow, actor: TaskActor): Promise<TaskRow> {
  requireStatus(task, [TaskStatus.Proposed], "không phải đề xuất");
  const confirmed = await transition(deps, task, [TaskStatus.Proposed], "status = ?, confirmed_at = NOW(3)", [TaskStatus.Open]);
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Confirmed, actor);
  await announceToAssignee(deps, confirmed, "confirmed");
  return confirmed;
}

/** Bỏ đề xuất (không phải việc thật). Không báo ai — người phụ trách chưa từng được báo. */
export async function rejectTask(deps: TaskDeps, task: TaskRow, actor: TaskActor, expired = false): Promise<TaskRow> {
  requireStatus(task, [TaskStatus.Proposed], "không phải đề xuất");
  const rejected = await transition(deps, task, [TaskStatus.Proposed], "status = ?, closed_at = NOW(3)", [TaskStatus.Cancelled]);
  await recordTaskEvent(deps.db, task.id, expired ? TaskEventKind.Expired : TaskEventKind.Rejected, actor);
  return rejected;
}

export async function finishTask(deps: TaskDeps, task: TaskRow, actor: TaskActor, note: string): Promise<TaskRow> {
  requireStatus(task, [TaskStatus.Open], "không đánh xong được");
  const done = await transition(deps, task, [TaskStatus.Open], "status = ?, closed_at = NOW(3), resolution = COALESCE(?, resolution)", [TaskStatus.Done, note || null]);
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Done, actor, note);
  await tellOthers(deps, task, actor, `${shortTaskCode(task)} «${task.title}» đã xong (${actor.name})${note ? `: ${note}` : "."}`, "done");
  return done;
}

/** Mở lại việc đã xong / đã hủy. Đề xuất đã bỏ (chưa từng xác nhận) thì không — giao việc mới cho rõ người, rõ hạn. */
export async function reopenTask(deps: TaskDeps, task: TaskRow, actor: TaskActor, note: string): Promise<TaskRow> {
  requireStatus(task, [TaskStatus.Done, TaskStatus.Cancelled], "đang mở");
  const reopened = await transition(deps, task, [TaskStatus.Done, TaskStatus.Cancelled], "status = ?, closed_at = NULL, remind_stage = ?",
    [TaskStatus.Open, initialStage(task.due_at ? { at: task.due_at, hasTime: task.due_has_time } : null)], "AND confirmed_at IS NOT NULL")
    .catch((error: unknown) => {
      if (error instanceof TaskActionError) throw new TaskActionError(`${shortTaskCode(task)} là đề xuất đã bỏ hoặc vừa được cập nhật — muốn làm thì giao việc mới.`);
      throw error;
    });
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Reopened, actor, note);
  await tellOthers(deps, task, actor, `${shortTaskCode(task)} «${task.title}» được mở lại (${actor.name})${note ? `: ${note}` : "."}`, "reopen");
  return reopened;
}

/** Dời hạn (hoặc đặt hạn cho việc chưa có hạn). Nhắc hạn tính lại từ đầu. */
export async function rescheduleTask(deps: TaskDeps, task: TaskRow, actor: TaskActor, due: TaskDue, note = ""): Promise<TaskRow> {
  requireStatus(task, OPEN_LIKE, "không dời hạn được");
  const updated = await transition(deps, task, OPEN_LIKE, "due_at = ?, due_has_time = ?, remind_stage = ?", [due.at, due.hasTime ? 1 : 0, initialStage(due)]);
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Rescheduled, actor, [`hạn ${dueText(updated)}`, note].filter(Boolean).join(" — "));
  if (updated.status === TaskStatus.Open) {
    await tellOthers(deps, updated, actor, `${shortTaskCode(task)} «${task.title}» đổi hạn thành ${dueText(updated)} (${actor.name}).`, "due");
  }
  return updated;
}

/** Giao lại cho người khác: báo người mới như việc mới, báo người cũ việc đã chuyển. */
export async function reassignTask(deps: TaskDeps, task: TaskRow, actor: TaskActor, assignee: TaskParty): Promise<TaskRow> {
  requireStatus(task, OPEN_LIKE, "không giao lại được");
  const updated = await transition(deps, task, OPEN_LIKE, "assignee_contact_id = ?, assignee_uid = ?, assignee_name = ?, remind_stage = ?",
    [assignee.contactId, assignee.uid, assignee.name.slice(0, 255), initialStage(task.due_at ? { at: task.due_at, hasTime: task.due_has_time } : null)]);
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Reassigned, actor, `${task.assignee?.name || "(chưa có)"} → ${assignee.name}`);
  if (updated.status === TaskStatus.Open) {
    if (task.assignee?.uid && task.assignee.uid !== assignee.uid && task.assignee.uid !== actor.uid) {
      await notifyTaskParty(deps, task, task.assignee, `${shortTaskCode(task)} «${task.title}» đã chuyển cho ${assignee.name} (${actor.name}).`, tag("moved"));
    }
    if (assignee.uid !== actor.uid) await announceToAssignee(deps, updated, "reassigned");
  }
  return updated;
}

export async function cancelTask(deps: TaskDeps, task: TaskRow, actor: TaskActor, note: string): Promise<TaskRow> {
  requireStatus(task, OPEN_LIKE, "không hủy được");
  const cancelled = await transition(deps, task, OPEN_LIKE, "status = ?, closed_at = NOW(3), resolution = COALESCE(?, resolution)", [TaskStatus.Cancelled, note || null]);
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Cancelled, actor, note);
  if (task.status === TaskStatus.Open) {
    await tellOthers(deps, task, actor, `${shortTaskCode(task)} «${task.title}» đã hủy (${actor.name})${note ? `: ${note}` : "."}`, "cancel");
  }
  return cancelled;
}

/** Ghi chú / nhắn về việc — báo các bên còn lại. */
export async function addTaskNote(deps: TaskDeps, task: TaskRow, actor: TaskActor, note: string): Promise<void> {
  if (!note.trim()) throw new TaskActionError("Thiếu nội dung ghi chú.");
  await recordTaskEvent(deps.db, task.id, TaskEventKind.Note, actor, note);
  if (task.status === TaskStatus.Open) await tellOthers(deps, task, actor, `${shortTaskCode(task)} «${task.title}» — ${actor.name}: ${note}`, "note");
}
