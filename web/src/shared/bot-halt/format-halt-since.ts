const HALT_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** `14:30 12/10` theo giờ Việt Nam — mốc bot bị tắt. Rỗng / không đọc được thì trả chuỗi rỗng (dải đỏ bỏ cụm "từ …"). */
export function formatHaltSince(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: HALT_TIME_ZONE, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('hour')}:${pick('minute')} ${pick('day')}/${pick('month')}`
}
