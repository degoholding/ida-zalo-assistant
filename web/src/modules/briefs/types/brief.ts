/** Loại bản tin / báo cáo — khớp `BriefKind` ở `src/constants.ts`. */
export const BRIEF_KIND = { morning: 1, evening: 2, weekly: 3, monthly: 4 } as const

/** Cái gì làm một bản tin / báo cáo được soạn — khớp `BriefTrigger` ở `src/constants.ts`. */
export const BRIEF_TRIGGER = { schedule: 1, chat: 2, webTest: 3 } as const

/** Một dòng `brief_log` tới đâu rồi — khớp `BriefStatus` ở `src/constants.ts`. */
export const BRIEF_STATUS = { composing: 1, queued: 2, sent: 3, failed: 4 } as const

export const BRIEF_KIND_OPTIONS = [
  { value: BRIEF_KIND.morning, label: 'Bản tin sáng' },
  { value: BRIEF_KIND.evening, label: 'Bản tin cuối ngày' },
  { value: BRIEF_KIND.weekly, label: 'Báo cáo tuần' },
  { value: BRIEF_KIND.monthly, label: 'Báo cáo tháng' },
]

export const BRIEF_TRIGGER_OPTIONS = [
  { value: BRIEF_TRIGGER.schedule, label: 'Theo lịch' },
  { value: BRIEF_TRIGGER.chat, label: 'Nhắn bot' },
  { value: BRIEF_TRIGGER.webTest, label: 'Gửi thử (web)' },
]

/** Trạng thái LƯU TRỮ thật của `brief_log` — dùng để lọc. Màn hiển thị trạng thái suy thêm «Không gửi được», xem `get-brief-display-status.ts`. */
export const BRIEF_STATUS_OPTIONS = [
  { value: BRIEF_STATUS.composing, label: 'Đang soạn' },
  { value: BRIEF_STATUS.queued, label: 'Đã xếp hàng gửi' },
  { value: BRIEF_STATUS.sent, label: 'Đã gửi' },
  { value: BRIEF_STATUS.failed, label: 'Lỗi' },
]

function findLabel(options: { value: number; label: string }[], value: number): string {
  return options.find((option) => option.value === value)?.label ?? ''
}

/** Mã lạ (máy chủ thêm giá trị mà giao diện chưa chép) → chuỗi rỗng, không làm vỡ màn. */
export function getBriefKindLabel(kind: number): string {
  return findLabel(BRIEF_KIND_OPTIONS, kind)
}

export function getBriefTriggerLabel(trigger: number): string {
  return findLabel(BRIEF_TRIGGER_OPTIONS, trigger)
}

/** Báo cáo tuần / tháng mới kèm tệp PDF + Excel — bản tin sáng / cuối ngày không có. */
export function isBriefReportKind(kind: number): boolean {
  return kind === BRIEF_KIND.weekly || kind === BRIEF_KIND.monthly
}

/** Một tệp đính kèm — tải qua id bản tin + CHỈ SỐ, máy chủ không bao giờ trả khóa lưu trữ thật (xem phase-05). */
export interface BriefFile {
  index: number
  file_name: string
  bytes: number
  download_url: string
}

/** Một dòng như `GET /api/briefs` trả về. */
export interface Brief {
  [key: string]: unknown
  id: number
  recipient_id: number
  recipient_name: string
  kind: number
  trigger_source: number
  period_key: string
  period_label: string
  status: number
  /** Rỗng = có điểm tin AI; khác rỗng = vì sao bị bỏ (tắt cài đặt / chưa khóa / chạm trần / lỗi). */
  ai_note: string
  has_ai: boolean
  error: string
  file_count: number
  created_at: string
  sent_at: string | null
}

/** `GET /api/briefs/:id`. */
export interface BriefDetail extends Brief {
  body: string
  files: BriefFile[]
}
