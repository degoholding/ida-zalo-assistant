import { TASK_STATUS, type TaskAction } from '../types/task'

/**
 * Nút thao tác hiện được với một trạng thái, theo đúng thứ tự bày trên hàng nút.
 *
 * Khớp luật của `src/tasks/task-service.ts`: xác nhận / bỏ chỉ ở đề xuất; xong, dời hạn, giao lại, hủy, ghi chú chỉ
 * khi đang làm; đã xong / đã hủy chỉ mở lại được. Mã trạng thái lạ thì không có nút nào — không đoán bừa việc đó
 * đang mở hay đóng.
 */
export function getTaskActions(status: number): TaskAction[] {
  switch (status) {
    case TASK_STATUS.proposed:
      return ['confirm', 'reject']
    case TASK_STATUS.open:
      return ['done', 'reschedule', 'reassign', 'cancel', 'note']
    case TASK_STATUS.done:
    case TASK_STATUS.cancelled:
      return ['reopen']
    default:
      return []
  }
}
