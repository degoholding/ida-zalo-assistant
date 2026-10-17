import { formatDue } from "./task-format.js";
import type { TaskActor, TaskParty, TaskRow } from "./task-repository.js";
import {
  addTaskNote, cancelTask, confirmTask, finishTask, reassignTask, rejectTask, reopenTask, rescheduleTask, TaskActionError, type TaskDeps, type TaskDue,
} from "./task-service.js";

// MỘT bảng «tên thao tác → hàm của task-service» cho màn Việc trên web (POST /api/tasks/:id/actions) và công cụ ghi qua MCP / trợ lý
// (confirm_write). Nơi gọi tự kiểm quyền + phạm vi, tự đọc hạn / người phụ trách mới; ở đây chỉ chạy và dựng câu cho nhật ký.

export const TASK_ACTION_LABELS: Record<string, string> = {
  confirm: "Xác nhận", reject: "Bỏ đề xuất", done: "Báo xong", reopen: "Mở lại", cancel: "Hủy", note: "Ghi chú",
  reschedule: "Dời hạn", reassign: "Giao lại",
};

export interface TaskActionArgs {
  note: string;
  /** Bắt buộc với `reschedule`. */
  due?: TaskDue | null;
  /** Bắt buộc với `reassign`. */
  assignee?: TaskParty | null;
}

/** Chạy thao tác; trả câu mô tả cho `audit_log.message`. Chuyển trạng thái sai → `TaskActionError`. */
export async function runTaskAction(deps: TaskDeps, task: TaskRow, actor: TaskActor, action: string, args: TaskActionArgs): Promise<string> {
  const { note } = args;
  let message = `${TASK_ACTION_LABELS[action]} ${task.code}`;
  if (action === "confirm") await confirmTask(deps, task, actor);
  else if (action === "reject") await rejectTask(deps, task, actor, false);
  else if (action === "done") await finishTask(deps, task, actor, note);
  else if (action === "reopen") await reopenTask(deps, task, actor, note);
  else if (action === "cancel") await cancelTask(deps, task, actor, note);
  else if (action === "note") await addTaskNote(deps, task, actor, note);
  else if (action === "reschedule") {
    if (!args.due) throw new TaskActionError("Chưa chọn hạn mới.");
    const updated = await rescheduleTask(deps, task, actor, args.due, note);
    message = `Dời hạn ${task.code} → ${formatDue(updated.due_at, updated.due_has_time)}`;
  } else if (action === "reassign") {
    if (!args.assignee) throw new TaskActionError("Chưa chọn người phụ trách mới.");
    await reassignTask(deps, task, actor, args.assignee);
    message = `Giao lại ${task.code} cho ${args.assignee.name}`;
  } else throw new TaskActionError("Thao tác không hợp lệ.");
  if (note && action !== "reschedule" && action !== "reassign") message += `: ${note}`;
  return message;
}
