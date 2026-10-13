/** Nguồn lệnh gửi — khớp `SendCommandSource` ở `src/constants.ts`; đổi bên đó thì sửa tay bên này. */
export const SEND_COMMAND_SOURCE = { zalo: 1, web: 2 } as const

/** Việc lệnh làm ở mỗi nơi nhận — khớp `SendActionKind` ở `src/constants.ts`. */
export const SEND_ACTION_KIND = { message: 1, reminder: 2, pin: 3 } as const

/** Vòng đời một lệnh gửi — khớp `SendCommandStatus` ở `src/constants.ts`. */
export const SEND_COMMAND_STATUS = { draft: 1, scheduled: 2, sending: 3, done: 4, cancelled: 5, expired: 6 } as const

/** Loại nơi nhận — khớp `SendTargetKind` ở `src/constants.ts`. */
export const SEND_TARGET_KIND = { group: 1, person: 2 } as const

/** Trạng thái từng nơi nhận — khớp `SendTargetStatus` ở `src/constants.ts`. */
export const SEND_TARGET_STATUS = { pending: 1, queued: 2, sent: 3, failed: 4, cancelled: 5 } as const

export const SEND_ACTION_KIND_OPTIONS = [
  { value: SEND_ACTION_KIND.message, label: 'Gửi tin' },
  { value: SEND_ACTION_KIND.reminder, label: 'Nhắc hẹn' },
  { value: SEND_ACTION_KIND.pin, label: 'Ghim' },
]

/** Kiểu lặp của nhắc hẹn Zalo (mã của Zalo; khớp `REPEAT_LABEL` ở `src/assistant/group-action-tools.ts`). */
const REMINDER_REPEAT_LABELS = ['Không lặp', 'Hằng ngày', 'Hằng tuần', 'Hằng tháng']

export const SEND_COMMAND_SOURCE_OPTIONS = [
  { value: SEND_COMMAND_SOURCE.zalo, label: 'Lệnh Zalo' },
  { value: SEND_COMMAND_SOURCE.web, label: 'Gửi từ web' },
]

/** Trạng thái LƯU TRỮ thật — dùng để lọc. Màn hiển thị trạng thái suy thêm từ số nơi lỗi, xem `get-send-command-display-status.ts`. */
export const SEND_COMMAND_STATUS_OPTIONS = [
  { value: SEND_COMMAND_STATUS.draft, label: 'Chờ xác nhận' },
  { value: SEND_COMMAND_STATUS.scheduled, label: 'Đang hẹn' },
  { value: SEND_COMMAND_STATUS.sending, label: 'Đang gửi' },
  { value: SEND_COMMAND_STATUS.done, label: 'Xong' },
  { value: SEND_COMMAND_STATUS.cancelled, label: 'Đã hủy' },
  { value: SEND_COMMAND_STATUS.expired, label: 'Nháp hết hạn' },
]

export const SEND_TARGET_KIND_OPTIONS = [
  { value: SEND_TARGET_KIND.group, label: 'Nhóm' },
  { value: SEND_TARGET_KIND.person, label: 'Người' },
]

export const SEND_TARGET_STATUS_OPTIONS = [
  { value: SEND_TARGET_STATUS.pending, label: 'Chưa xếp' },
  { value: SEND_TARGET_STATUS.queued, label: 'Chờ gửi' },
  { value: SEND_TARGET_STATUS.sent, label: 'Đã gửi' },
  { value: SEND_TARGET_STATUS.failed, label: 'Lỗi' },
  { value: SEND_TARGET_STATUS.cancelled, label: 'Đã hủy' },
]

function findLabel(options: { value: number; label: string }[], value: number): string {
  return options.find((option) => option.value === value)?.label ?? ''
}

/** Mã lạ (máy chủ thêm giá trị mà giao diện chưa chép) → chuỗi rỗng, không làm vỡ màn. */
export function getSendCommandSourceLabel(source: number): string {
  return findLabel(SEND_COMMAND_SOURCE_OPTIONS, source)
}

export function getSendActionKindLabel(kind: number): string {
  return findLabel(SEND_ACTION_KIND_OPTIONS, kind)
}

export function getReminderRepeatLabel(repeat: number): string {
  return REMINDER_REPEAT_LABELS[repeat] ?? ''
}

export function getSendTargetKindLabel(kind: number): string {
  return findLabel(SEND_TARGET_KIND_OPTIONS, kind)
}

export function getSendTargetStatusLabel(status: number): string {
  return findLabel(SEND_TARGET_STATUS_OPTIONS, status)
}

/** Mã hiển thị của lệnh — khớp `formatCommandCode` ở máy chủ. */
export function formatSendCommandCode(id: number): string {
  return `G-${id}`
}

/** Một dòng như `GET /api/send-commands` trả về. */
export interface SendCommand {
  [key: string]: unknown
  id: number
  source: number
  status: number
  /** `SEND_ACTION_KIND`: gửi tin hay nhắc hẹn Zalo cho nhóm */
  action_kind: number
  /** Chỉ nhắc hẹn: giờ nhắc + kiểu lặp (0 không · 1 ngày · 2 tuần · 3 tháng) */
  reminder_at: string | null
  reminder_repeat: number
  requester_uid: string
  requester_name: string
  scheduled_at: string | null
  off_hours_note: string
  cancelled_by: string
  created_at: string
  reported_at: string | null
  /** 80 ký tự đầu của nội dung */
  body_preview: string
  body_truncated: boolean
  target_count: number
  sent_count: number
  failed_count: number
}

/** Một nơi nhận trong `GET /api/send-commands/:id`. */
export interface SendTarget {
  id: number
  kind: number
  /** Có cuộc hội thoại thì mở được từ màn Hội thoại */
  thread_id: number | null
  display_name: string
  status: number
  attempt_no: number
  error: string
  sent_at: string | null
}

/** Tệp kèm — chỉ tên, máy chủ không trả khóa lưu trữ. */
export interface SendCommandFile {
  id: number
  file_name: string
}

/** `GET /api/send-commands/:id`. */
export interface SendCommandDetail extends SendCommand {
  body: string
  files: SendCommandFile[]
  targets: SendTarget[]
}

export type SendCommandAction = 'cancel' | 'resend_failed'

export interface SendCommandActionRequest {
  action: SendCommandAction
}
