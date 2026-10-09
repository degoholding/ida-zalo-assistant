import type { TaskParty, TaskRow } from "./task-repository.js";

// Ai làm được gì với một việc trên Zalo (phase 7). Một chỗ — lệnh gõ và công cụ trợ lý cùng đi qua đây. Màn web dùng quyền
// vai trò web (quản trị / quản lý sửa, nhân viên xem) — src/web/api/tasks-api.ts.
//   «sếp» (overseer) = người có vai trò (Quản lý / Trưởng phòng) hoặc người nhận đang bật — xem / quản lý mọi việc.
//   Người giao: xem, xong, dời hạn, giao lại, hủy, xác nhận / bỏ đề xuất của mình.
//   Người phụ trách: xem, xong, ghi chú.
//   Thành viên nhóm: xem việc giao trong chính nhóm đó (bot đã nhắc công khai trong nhóm).

export interface TaskViewer {
  uid: string;
  contactId: number | null;
  overseer: boolean;
  /** Đang hỏi trong nhóm này (null = tin riêng) */
  groupId: number | null;
}

const isParty = (viewer: TaskViewer, party: TaskParty | null) =>
  Boolean(party && ((party.uid && party.uid === viewer.uid) || (viewer.contactId !== null && party.contactId === viewer.contactId)));

export const isTaskAssigner = (viewer: TaskViewer, task: TaskRow) => isParty(viewer, task.assigner);
export const isTaskAssignee = (viewer: TaskViewer, task: TaskRow) => isParty(viewer, task.assignee);

/** Trong nhóm chỉ thấy việc của nhóm đó (như mọi công cụ khi hỏi trong nhóm). */
export function canViewTask(viewer: TaskViewer, task: TaskRow): boolean {
  if (viewer.groupId !== null) return task.source_thread_id === viewer.groupId;
  return viewer.overseer || isTaskAssigner(viewer, task) || isTaskAssignee(viewer, task);
}

/** Đánh xong / ghi chú. */
export function canWorkOnTask(viewer: TaskViewer, task: TaskRow): boolean {
  return canViewTask(viewer, task) && (viewer.overseer || isTaskAssigner(viewer, task) || isTaskAssignee(viewer, task));
}

/** Dời hạn, giao lại, hủy, mở lại, xác nhận / bỏ đề xuất. */
export function canManageTask(viewer: TaskViewer, task: TaskRow): boolean {
  return canViewTask(viewer, task) && (viewer.overseer || isTaskAssigner(viewer, task));
}
