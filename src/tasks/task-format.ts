import { TaskPriority, TaskStatus } from "../constants.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import { shortTaskCode, type TaskRow } from "./task-repository.js";

// Chữ hiển thị của việc trên Zalo: trạng thái, hạn («17:00 T6 18/10»), một dòng tóm tắt, chi tiết. Hàm thuần.

const DAY_MS = 86_400_000;
const WEEKDAYS = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.Proposed]: "chờ xác nhận",
  [TaskStatus.Open]: "đang làm",
  [TaskStatus.Done]: "đã xong",
  [TaskStatus.Cancelled]: "đã hủy",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.High]: "Cao",
  [TaskPriority.Normal]: "TB",
  [TaskPriority.Low]: "Thấp",
};

/** Mốc hết hạn thật: hạn có giờ = đúng giờ đó; hạn chỉ có ngày (lưu 00:00 giờ VN) = hết ngày đó. */
export function dueDeadline(task: Pick<TaskRow, "due_at" | "due_has_time">): Date | null {
  if (!task.due_at) return null;
  return task.due_has_time ? task.due_at : new Date(task.due_at.getTime() + DAY_MS);
}

export function isTaskOverdue(task: Pick<TaskRow, "status" | "due_at" | "due_has_time">, now: Date): boolean {
  const deadline = dueDeadline(task);
  return task.status === TaskStatus.Open && deadline !== null && deadline.getTime() <= now.getTime();
}

/** «17:00 T6 18/10», «T6 18/10», khác năm thì thêm năm; không có hạn → «chưa có hạn». */
export function formatDue(dueAt: Date | null, hasTime: boolean, now: Date = new Date()): string {
  if (!dueAt) return "chưa có hạn";
  const local = vnLocalTime(dueAt);
  const [year, month, day] = local.date.split("-");
  const sameYear = vnLocalTime(now).date.slice(0, 4) === year;
  const date = `${WEEKDAYS[local.weekday]} ${day}/${month}${sameYear ? "" : `/${year}`}`;
  if (!hasTime) return date;
  const hours = String(Math.floor(local.minuteOfDay / 60)).padStart(2, "0");
  const minutes = String(local.minuteOfDay % 60).padStart(2, "0");
  return `${hours}:${minutes} ${date}`;
}

/** «quá hạn 3 ngày» / «quá hạn» (trong ngày) — chỉ việc đang làm đã quá hạn; còn lại chuỗi rỗng. */
export function overdueLabel(task: Pick<TaskRow, "status" | "due_at" | "due_has_time">, now: Date): string {
  if (!isTaskOverdue(task, now)) return "";
  const deadline = dueDeadline(task)!;
  const days = Math.floor((vnLocalTime(now).dayStartMs - vnLocalTime(deadline).dayStartMs) / DAY_MS);
  return days >= 1 ? `quá hạn ${days} ngày` : "quá hạn";
}

/** Một dòng: «V-12 Gửi báo giá đại lý XT — Minh — hạn T6 18/10 (quá hạn 2 ngày)». */
export function describeTaskLine(task: TaskRow, now: Date = new Date()): string {
  const who = task.assignee?.name || "chưa có người phụ trách";
  const overdue = overdueLabel(task, now);
  const status = task.status === TaskStatus.Open ? "" : ` [${TASK_STATUS_LABELS[task.status]}]`;
  return `${shortTaskCode(task)}${status} ${task.title} — ${who} — hạn ${formatDue(task.due_at, task.due_has_time, now)}${overdue ? ` (${overdue})` : ""}`;
}

/** Chi tiết một việc cho tin Zalo. */
export function describeTask(task: TaskRow, now: Date = new Date()): string {
  const overdue = overdueLabel(task, now);
  return [
    `${shortTaskCode(task)}: ${task.title}`,
    `Trạng thái: ${TASK_STATUS_LABELS[task.status]}${overdue ? ` — ${overdue}` : ""}`,
    `Người phụ trách: ${task.assignee?.name || "(chưa có)"}`,
    `Hạn: ${formatDue(task.due_at, task.due_has_time, now)} · Ưu tiên: ${TASK_PRIORITY_LABELS[task.priority]}`,
    `Người giao: ${task.assigner.name || "(không rõ)"}`,
    ...(task.resolution ? [`Ghi chú: ${task.resolution}`] : []),
  ].join("\n");
}
