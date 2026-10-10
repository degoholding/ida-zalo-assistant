import type { StatusTone } from '@/shared/ui/status-tone'
import { BRIEF_STATUS, isBriefReportKind } from '../types/brief'

/**
 * Trạng thái hiển thị suy từ `status` + tuổi dòng (phase-05): «Đã xếp hàng gửi» quá lâu mà vẫn chưa `Sent` coi như
 * không gửi được — job tin riêng (`enqueueRecipientMessage`) hết hạn sau 2 giờ, job có kèm tệp PDF/Excel thì rộng hơn,
 * cho 12 giờ. Hai mốc này KHÔNG phải trạng thái lưu trong CSDL — chỉ để người xem màn khỏi tưởng bản tin đang treo mãi.
 */
export type BriefDisplayStatus = 'composing' | 'queued' | 'sent' | 'failed' | 'undeliverable'

const HOUR_MS = 60 * 60 * 1000
const QUEUED_TIMEOUT_NO_FILE_MS = 2 * HOUR_MS
const QUEUED_TIMEOUT_WITH_FILE_MS = 12 * HOUR_MS

export interface BriefForDisplayStatus {
  status: number
  kind: number
  created_at: string
}

/** `now` truyền vào để test không phụ thuộc "giờ hiện tại" (luật test chung của dự án). */
export function getBriefDisplayStatus(brief: BriefForDisplayStatus, now: Date = new Date()): BriefDisplayStatus {
  if (brief.status === BRIEF_STATUS.sent) return 'sent'
  if (brief.status === BRIEF_STATUS.failed) return 'failed'
  if (brief.status === BRIEF_STATUS.composing) return 'composing'
  // Còn lại: Queued — ngày giờ đọc không nổi thì đừng dọa người dùng bằng «Không gửi được» oan
  const created = new Date(brief.created_at).getTime()
  if (Number.isNaN(created)) return 'queued'
  const timeout = isBriefReportKind(brief.kind) ? QUEUED_TIMEOUT_WITH_FILE_MS : QUEUED_TIMEOUT_NO_FILE_MS
  return now.getTime() - created > timeout ? 'undeliverable' : 'queued'
}

const DISPLAY_STATUS_LABELS: Record<BriefDisplayStatus, string> = {
  composing: 'Đang soạn',
  queued: 'Đã xếp hàng gửi',
  sent: 'Đã gửi',
  failed: 'Lỗi',
  undeliverable: 'Không gửi được',
}

/** Chờ gửi = hổ phách, đã gửi = xanh lá, lỗi = đỏ; «không gửi được» khác «lỗi» thật (lỗi có lý do rõ) nên dùng tông cam riêng. */
const DISPLAY_STATUS_TONE: Record<BriefDisplayStatus, StatusTone> = {
  composing: 'pending',
  queued: 'progress',
  sent: 'done',
  failed: 'danger',
  undeliverable: 'returned',
}

export function getBriefDisplayStatusLabel(status: BriefDisplayStatus): string {
  return DISPLAY_STATUS_LABELS[status]
}

export function getBriefDisplayStatusTone(status: BriefDisplayStatus): StatusTone {
  return DISPLAY_STATUS_TONE[status]
}
