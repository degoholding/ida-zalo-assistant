import { formatDate, formatDateTime } from '@/shared/utils/format-date'

/**
 * Hạn hiển thị trên màn Việc: có giờ → ngày giờ, chỉ có ngày → ngày, chưa có hạn → nói rõ ra. Hàm thuần — «quá hạn»
 * đi theo cờ `overdue` máy chủ đã tính sẵn (`src/web/api/tasks-api.ts`), không tính lại ở đây.
 */
export function formatTaskDue(dueAt: string | null, dueHasTime: boolean): string {
  if (!dueAt) return 'Chưa có hạn'
  return dueHasTime ? formatDateTime(dueAt) : formatDate(dueAt)
}
