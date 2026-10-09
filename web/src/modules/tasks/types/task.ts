import type { StatusTone } from '@/shared/ui/status-tone'

/** Trạng thái việc — khớp `TaskStatus` ở `src/constants.ts` của máy chủ; đổi bên đó thì sửa tay bên này. */
export const TASK_STATUS = { proposed: 1, open: 2, done: 3, cancelled: 4 } as const

/** Ưu tiên việc — khớp `TaskPriority` ở `src/constants.ts`. */
export const TASK_PRIORITY = { high: 1, normal: 2, low: 3 } as const

/** Nguồn tạo việc — khớp `TaskSource` ở `src/constants.ts`. */
export const TASK_SOURCE = { command: 1, assistant: 2, recap: 3, aiReview: 4, web: 5 } as const

/** Loại dòng nhật ký việc — khớp `TaskEventKind` ở `src/constants.ts`. */
export const TASK_EVENT_KIND = {
  created: 1, confirmed: 2, rejected: 3, done: 4, reopened: 5, rescheduled: 6, reassigned: 7, cancelled: 8, note: 9, reminded: 10, expired: 11,
} as const

export const TASK_STATUS_OPTIONS = [
  { value: TASK_STATUS.proposed, label: 'Chờ xác nhận' },
  { value: TASK_STATUS.open, label: 'Đang làm' },
  { value: TASK_STATUS.done, label: 'Đã xong' },
  { value: TASK_STATUS.cancelled, label: 'Đã hủy' },
]

export const TASK_PRIORITY_OPTIONS = [
  { value: TASK_PRIORITY.high, label: 'Cao' },
  { value: TASK_PRIORITY.normal, label: 'Trung bình' },
  { value: TASK_PRIORITY.low, label: 'Thấp' },
]

const TASK_SOURCE_LABELS: Record<number, string> = {
  [TASK_SOURCE.command]: 'Lệnh Zalo',
  [TASK_SOURCE.assistant]: 'Trợ lý AI',
  [TASK_SOURCE.recap]: 'Recap họp',
  [TASK_SOURCE.aiReview]: 'AI rà soát',
  [TASK_SOURCE.web]: 'Web',
}

/**
 * Màu nhãn trạng thái — bốn mốc liền nhau khác nhau rõ (luật ở `status-tone.ts`): Chờ xác nhận = nằm chờ, Đang làm =
 * đã qua cửa duyệt đang chạy, Đã xong = xanh lá, Đã hủy = đỏ (mốc khóa).
 */
const TASK_STATUS_TONE: Record<number, StatusTone> = {
  [TASK_STATUS.proposed]: 'pending',
  [TASK_STATUS.open]: 'progress',
  [TASK_STATUS.done]: 'done',
  [TASK_STATUS.cancelled]: 'danger',
}

const TASK_EVENT_LABELS: Record<number, string> = {
  [TASK_EVENT_KIND.created]: 'Tạo',
  [TASK_EVENT_KIND.confirmed]: 'Xác nhận',
  [TASK_EVENT_KIND.rejected]: 'Bỏ đề xuất',
  [TASK_EVENT_KIND.done]: 'Xong',
  [TASK_EVENT_KIND.reopened]: 'Mở lại',
  [TASK_EVENT_KIND.rescheduled]: 'Dời hạn',
  [TASK_EVENT_KIND.reassigned]: 'Giao lại',
  [TASK_EVENT_KIND.cancelled]: 'Hủy',
  [TASK_EVENT_KIND.note]: 'Ghi chú',
  [TASK_EVENT_KIND.reminded]: 'Nhắc hạn',
  [TASK_EVENT_KIND.expired]: 'Hết hạn xác nhận',
}

/** Mã lạ (máy chủ thêm trạng thái mà giao diện chưa chép) → chuỗi rỗng, không làm vỡ màn. */
export function getTaskStatusLabel(status: number): string {
  return TASK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? ''
}

export function getTaskStatusTone(status: number): StatusTone {
  return TASK_STATUS_TONE[status] ?? 'neutral'
}

export function getTaskPriorityLabel(priority: number): string {
  return TASK_PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? ''
}

export function getTaskSourceLabel(source: number): string {
  return TASK_SOURCE_LABELS[source] ?? ''
}

export function getTaskEventLabel(kind: number): string {
  return TASK_EVENT_LABELS[kind] ?? ''
}

/** Việc đang mở (còn phải làm) = Chờ xác nhận hoặc Đang làm — khớp `isOpenLike` của `src/tasks/task-service.ts`. */
export function isTaskOpen(status: number): boolean {
  return status === TASK_STATUS.proposed || status === TASK_STATUS.open
}

/** Một việc như `GET /api/tasks` trả về. */
export interface Task {
  [key: string]: unknown
  id: number
  /** Mã hiển thị, vd «V-0012». */
  code: string
  status: number
  priority: number
  title: string
  assignee_contact_id: number | null
  assignee_name: string
  assigner_name: string
  source: number
  source_thread_id: number | null
  /** Tên nhóm, hoặc «Tin riêng»; rỗng khi không gắn nhóm nào. */
  source_thread_name: string
  due_at: string | null
  due_has_time: boolean
  /** Máy chủ tự tính: đang làm + đã qua mốc hết hạn. */
  overdue: boolean
  missing_assignee: boolean
  missing_due: boolean
  created_at: string
}

/** Một dòng nhật ký việc. */
export interface TaskEvent {
  id: number
  kind: number
  actor_name: string
  via: 'zalo' | 'web' | 'system' | string
  note: string
  created_at: string
}

/** `GET /api/tasks/:id`. */
export interface TaskDetail extends Task {
  resolution: string
  updated_at: string
  confirmed_at: string | null
  closed_at: string | null
  source_message_id: number | null
  events: TaskEvent[]
}

/** Thao tác trên web — `POST /api/tasks/:id/actions`. */
export type TaskAction = 'confirm' | 'reject' | 'done' | 'reopen' | 'cancel' | 'note' | 'reschedule' | 'reassign'

export interface TaskActionRequest {
  action: TaskAction
  /** Tối đa `TASK_NOTE_MAX` ký tự. */
  note?: string
  /** 'YYYY-MM-DD' — dời hạn. */
  due_date?: string
  /** 'HH:mm' — tùy chọn, đi kèm `due_date`. */
  due_time?: string
  /** Giao lại. */
  assignee_contact_id?: number
}

/** Trần ghi chú — khớp `NOTE_MAX` của `src/web/api/tasks-api.ts`. */
export const TASK_NOTE_MAX = 2000

/** Tạo việc trên web — `POST /api/tasks`. */
export interface CreateTaskRequest {
  title: string
  assignee_contact_id?: number
  due_date?: string
  due_time?: string
  priority?: number
  source_thread_id?: number
}
