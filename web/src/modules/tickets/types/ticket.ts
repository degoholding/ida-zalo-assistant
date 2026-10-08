import type { StatusTone } from '@/shared/ui/status-tone'

/** Trạng thái ticket — khớp `TicketStatus` ở `src/constants.ts` của máy chủ; đổi bên đó thì sửa tay bên này. */
export const TICKET_STATUS = { new: 1, inProgress: 2, done: 3, cancelled: 4 } as const

/** Loại dòng nhật ký ticket — khớp `TicketEventKind` ở `src/constants.ts` của máy chủ. */
export const TICKET_EVENT_KIND = { created: 1, accepted: 2, note: 3, done: 4, cancelled: 5, reopened: 6 } as const

/** Trạng thái tệp đính kèm — khớp `AttachmentStatus.Pending` ở `src/constants.ts` (tệp chưa tải về kho). */
export const ATTACHMENT_STATUS_PENDING = 0

export const TICKET_STATUS_OPTIONS = [
  { value: TICKET_STATUS.new, label: 'Mới' },
  { value: TICKET_STATUS.inProgress, label: 'Đang xử lý' },
  { value: TICKET_STATUS.done, label: 'Đã xong' },
  { value: TICKET_STATUS.cancelled, label: 'Đã hủy' },
]

/**
 * Màu nhãn trạng thái — bốn mốc liền nhau phải khác nhau rõ (luật ở `status-tone.ts`): Mới = nằm chờ người nhận,
 * Đang xử lý = có người đang làm, Đã xong = xanh lá, Đã hủy = đỏ (mốc khóa).
 */
const TICKET_STATUS_TONE: Record<number, StatusTone> = {
  [TICKET_STATUS.new]: 'pending',
  [TICKET_STATUS.inProgress]: 'active',
  [TICKET_STATUS.done]: 'done',
  [TICKET_STATUS.cancelled]: 'danger',
}

const TICKET_EVENT_LABELS: Record<number, string> = {
  [TICKET_EVENT_KIND.created]: 'Tạo',
  [TICKET_EVENT_KIND.accepted]: 'Nhận xử lý',
  [TICKET_EVENT_KIND.note]: 'Bổ sung / nhắn',
  [TICKET_EVENT_KIND.done]: 'Xong',
  [TICKET_EVENT_KIND.cancelled]: 'Hủy',
  [TICKET_EVENT_KIND.reopened]: 'Mở lại',
}

/** Mã lạ (máy chủ thêm trạng thái mà giao diện chưa chép) → chuỗi rỗng, không làm vỡ màn. */
export function getTicketStatusLabel(status: number): string {
  return TICKET_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? ''
}

export function getTicketStatusTone(status: number): StatusTone {
  return TICKET_STATUS_TONE[status] ?? 'neutral'
}

export function getTicketEventLabel(kind: number): string {
  return TICKET_EVENT_LABELS[kind] ?? ''
}

/** Ticket mở = Mới hoặc Đang xử lý — khớp `isOpen` của `src/tickets/ticket-service.ts`. */
export function isTicketOpen(status: number): boolean {
  return status === TICKET_STATUS.new || status === TICKET_STATUS.inProgress
}

/** Một ticket như `GET /api/tickets` trả về. */
export interface Ticket {
  [key: string]: unknown
  id: number
  /** Mã hiển thị, vd «T-0012». */
  code: string
  status: number
  title: string
  body: string
  requester_name: string
  requester_uid: string
  handler_name: string
  resolution: string
  /** `group` = báo trong nhóm, `direct` = tin riêng với bot, rỗng = không rõ nguồn. */
  source_kind: 'group' | 'direct' | ''
  /** Tên nhóm, hoặc «Tin riêng»; rỗng khi không rõ nguồn. */
  source_name: string
  attachment_count: number
  created_at: string
  updated_at: string
  accepted_at: string | null
  closed_at: string | null
}

/** Một ảnh / tệp đính kèm ticket. */
export interface TicketAttachment {
  id: number
  file_name: string
  is_image: boolean
  status: number
  bytes: number | null
  /** `null` = tệp chưa có trong kho (đang tải về hoặc lỗi). Ảnh thêm `?inline=1` để xem tại chỗ. */
  download_url: string | null
}

/** Một dòng nhật ký ticket. */
export interface TicketEvent {
  id: number
  kind: number
  actor_name: string
  via: 'zalo' | 'web' | string
  note: string
  created_at: string
}

/** `GET /api/tickets/:id`. */
export interface TicketDetail extends Ticket {
  attachments: TicketAttachment[]
  events: TicketEvent[]
}

/** Thao tác trên web — `POST /api/tickets/:id/actions`. */
export type TicketAction = 'accept' | 'done' | 'cancel' | 'reopen' | 'note'

export interface TicketActionRequest {
  action: TicketAction
  /** Tối đa `TICKET_NOTE_MAX` ký tự; bắt buộc với `note`. */
  note?: string
}

/** Trần ghi chú — khớp `NOTE_MAX` của `src/web/api/tickets-api.ts`. */
export const TICKET_NOTE_MAX = 2000

/** Một người xử lý ticket — `GET /api/ticket-handlers`. */
export interface TicketHandler {
  contact_id: number
  zalo_uid: string
  name: string
  avatar_url: string | null
  created_at: string
}
