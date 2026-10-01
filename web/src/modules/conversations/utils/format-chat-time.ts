import { formatDate, formatTime } from '@/shared/utils/format-date'

const DAY_MS = 86_400_000

function dayKey(value: string | Date): string {
  return formatDate(value)
}

/** Nhãn ngăn ngày trong khung chat: Hôm nay / Hôm qua / 30/09 / 30/09/2025. */
export function formatDayLabel(value: string, now = new Date()): string {
  const key = dayKey(value)
  if (key === dayKey(now)) return 'Hôm nay'
  if (key === dayKey(new Date(now.getTime() - DAY_MS))) return 'Hôm qua'
  const sameYear = new Date(value).getFullYear() === now.getFullYear()
  return sameYear ? key.slice(0, 5) : key
}

/** Giờ ngắn cho danh sách cuộc: hôm nay → 14:05, năm nay → 30/09, năm khác → 30/09/25. */
export function formatShortTime(value: string | null, now = new Date()): string {
  if (!value) return ''
  if (dayKey(value) === dayKey(now)) return formatTime(value)
  const full = formatDate(value)
  return new Date(value).getFullYear() === now.getFullYear() ? full.slice(0, 5) : `${full.slice(0, 6)}${full.slice(8)}`
}

export function isSameDay(a: string, b: string): boolean {
  return dayKey(a) === dayKey(b)
}

/** Hai tin cùng người, cách nhau dưới 5 phút thì gộp thành một «đợt». */
export const RUN_GAP_MS = 5 * 60_000

export function isSameRun(previous: { sender_uid: string; sent_at: string } | null, current: { sender_uid: string; sent_at: string }): boolean {
  if (!previous || previous.sender_uid !== current.sender_uid) return false
  if (!isSameDay(previous.sent_at, current.sent_at)) return false
  return new Date(current.sent_at).getTime() - new Date(previous.sent_at).getTime() < RUN_GAP_MS
}

export interface TimelineRow<T> {
  message: T
  /** Tin đầu của một ngày mới → vẽ ngăn ngày phía trên. */
  newDay: boolean
  firstOfRun: boolean
  lastOfRun: boolean
}

/** Gắn cờ ngăn ngày / đầu đợt / cuối đợt cho từng tin — hàm thuần, bài kiểm chạy không cần DOM. */
export function buildTimelineRows<T extends { sender_uid: string; sent_at: string }>(messages: T[]): TimelineRow<T>[] {
  return messages.map((message, index) => {
    const previous = index > 0 ? messages[index - 1] : null
    const next = messages[index + 1]
    const newDay = !previous || !isSameDay(previous.sent_at, message.sent_at)
    return { message, newDay, firstOfRun: newDay || !isSameRun(previous, message), lastOfRun: !next || !isSameRun(message, next) }
  })
}
