import type { StatusTone } from '@/shared/ui/status-tone'

/** Vòng đời mẫu tin — khớp `ReplyTemplateStatus` ở `src/constants.ts`; đổi bên đó thì sửa tay bên này. */
export const REPLY_TEMPLATE_STATUS = { draft: 1, pendingReview: 2, approved: 3, returned: 4, archived: 5 } as const

/** Tông mẫu tin — khớp `ReplyTone` ở `src/constants.ts`. */
export const REPLY_TONE = { formal: 1, friendly: 2, brief: 3 } as const

export const REPLY_TEMPLATE_STATUS_OPTIONS = [
  { value: REPLY_TEMPLATE_STATUS.draft, label: 'Nháp' },
  { value: REPLY_TEMPLATE_STATUS.pendingReview, label: 'Chờ duyệt' },
  { value: REPLY_TEMPLATE_STATUS.approved, label: 'Đã duyệt' },
  { value: REPLY_TEMPLATE_STATUS.returned, label: 'Bị trả lại' },
  { value: REPLY_TEMPLATE_STATUS.archived, label: 'Ngừng dùng' },
]

export const REPLY_TONE_OPTIONS = [
  { value: REPLY_TONE.formal, label: 'Lịch sự' },
  { value: REPLY_TONE.friendly, label: 'Thân thiện' },
  { value: REPLY_TONE.brief, label: 'Ngắn gọn' },
]

function findLabel(options: { value: number; label: string }[], value: number): string {
  return options.find((option) => option.value === value)?.label ?? ''
}

/** Mã lạ (máy chủ thêm giá trị mà giao diện chưa chép) → chuỗi rỗng, không làm vỡ màn. */
export function getReplyTemplateStatusLabel(status: number): string {
  return findLabel(REPLY_TEMPLATE_STATUS_OPTIONS, status)
}

export function getReplyToneLabel(tone: number): string {
  return findLabel(REPLY_TONE_OPTIONS, tone)
}

const REPLY_TEMPLATE_STATUS_TONE: Record<number, StatusTone> = {
  [REPLY_TEMPLATE_STATUS.draft]: 'neutral',
  [REPLY_TEMPLATE_STATUS.pendingReview]: 'pending',
  [REPLY_TEMPLATE_STATUS.approved]: 'done',
  [REPLY_TEMPLATE_STATUS.returned]: 'danger',
  [REPLY_TEMPLATE_STATUS.archived]: 'closed',
}

export function getReplyTemplateStatusTone(status: number): StatusTone {
  return REPLY_TEMPLATE_STATUS_TONE[status] ?? 'neutral'
}

/** Thao tác đổi trạng thái — khớp `POST /api/reply-templates/:id/actions`. Lưu / sửa đi qua biểu mẫu (PATCH), không phải thao tác này. */
export type ReplyTemplateAction = 'submit' | 'approve' | 'return' | 'archive'

export interface ReplyTemplateActionRequest {
  action: ReplyTemplateAction
  /** Chỉ `return`: bắt buộc, 5-500 ký tự. */
  note?: string
}

/** Độ dài ghi chú trả lại — khớp `RETURN_NOTE_MIN / MAX` ở `src/reply-suggestions/reply-template-workflow.ts`. */
export const RETURN_NOTE_MIN = 5
export const RETURN_NOTE_MAX = 500

/** Một mẫu tin như API trả về (`keywords` là chuỗi cách nhau dấu phẩy; `can_*` tính theo người đang đăng nhập). */
export interface ReplyTemplate {
  // Khung CRUD cần chỉ mục chuỗi (`CrudRecord`) — cùng cách với `SendCommand`
  [key: string]: unknown
  id: number
  name: string
  situation: string
  keywords: string
  body: string
  tone: number
  status: number
  author_user_id: number | null
  author_name: string
  reviewer_user_id: number | null
  reviewer_name: string
  review_note: string
  submitted_at: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  can_edit: boolean
  can_review: boolean
}
