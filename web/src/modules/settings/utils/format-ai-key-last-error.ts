import type { AiKeyItem } from '../types/ai-key'

const TIME_ZONE = 'Asia/Ho_Chi_Minh'

function formatVnParts(date: Date) {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { time: `${pick('hour')}:${pick('minute')}`, day: `${pick('day')}/${pick('month')}` }
}

/**
 * «Lỗi lúc 14:05: hết tiền (402)» — bot đã bỏ qua khóa này lúc đó và chuyển sang khóa kế. Khác ngày (giờ Việt Nam) thì kèm
 * ngày «Lỗi lúc 14:05 06/10: …». Chưa từng lỗi / ngày hỏng thì rỗng.
 */
export function formatAiKeyLastError(item: Pick<AiKeyItem, 'last_error' | 'last_error_at'>, now: Date): string {
  if (!item.last_error || !item.last_error_at) return ''
  const at = new Date(item.last_error_at)
  if (Number.isNaN(at.getTime())) return ''
  const when = formatVnParts(at)
  const today = formatVnParts(now).day
  return `Lỗi lúc ${when.time}${when.day === today ? '' : ` ${when.day}`}: ${item.last_error}`
}
