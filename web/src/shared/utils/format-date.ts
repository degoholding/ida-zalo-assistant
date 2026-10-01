/**
 * Ngày giờ theo chuẩn hiển thị của hệ: dd/mm/yyyy.
 * Backend trả chuỗi ISO (`2026-08-11` hoặc `2026-08-11T09:30:00`).
 */

/** `11/08/2026`. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** `11/08/2026 09:30`. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  return `${formatDate(date)} ${date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

/**
 * `09:30` — chỉ GIỜ, dùng cho dòng thời gian đã có mốc ngày ở đầu cụm.
 *
 * 24 giờ chứ không `2:05 PM`: cả hệ hiển thị giờ theo lối Việt Nam, và cột giờ
 * xếp thẳng hàng chỉ khi mọi dòng cùng độ dài.
 */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** `Thứ Tư, 12.08.2026` — dạng đầy đủ dùng ở màn chọn phân hệ. */
export function formatWeekdayDate(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  const weekday = date.toLocaleDateString('vi-VN', { weekday: 'long' })
  // Viết hoa chữ đầu: vi-VN trả "thứ tư", cần "Thứ Tư" cho tiêu đề.
  const label = weekday.replace(/(^|\s)\p{Ll}/gu, (c) => c.toUpperCase())
  const [day, month, year] = [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ]
  return `${label}, ${day}.${month}.${year}`
}

/**
 * `Vừa xong` · `5 phút trước` · `3 giờ trước` · `2 ngày trước` · `1 tuần trước`
 * · `1 tháng trước`, quá ~2 tháng thì trả về ngày cụ thể — dùng cho dòng thời
 * gian kiểu bảng tin (diễn đàn). Chuyển theo khuôn `fmtRelative` của v1.
 *
 * `now` truyền được từ ngoài để test không phụ thuộc "hôm nay"; mốc TƯƠNG LAI
 * quá 5 phút là dữ liệu hỏng — hiện thẳng ngày giờ cho lộ ra thay vì âm số.
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value)
  if (!date) return ''
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (minutes < -5) return formatDateTime(date)
  if (minutes < 1) return 'Vừa xong'
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ngày trước`
  if (days < 30) return `${Math.floor(days / 7)} tuần trước`
  if (days < 60) return `${Math.floor(days / 30)} tháng trước`
  return formatDate(date)
}

/** `2026-08-11` — dạng dùng cho `<input type="date">` và tham số query. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
}

/**
 * `'2026-08-11'` → `Date` lúc 00:00 giờ ĐỊA PHƯƠNG. Rỗng / sai dạng → `undefined`.
 *
 * Tách số rồi dựng bằng `new Date(y, m, d)` chứ KHÔNG `new Date('2026-08-11')`:
 * chuỗi chỉ có ngày được ECMAScript hiểu là mốc UTC, nên ở múi giờ dương như VN
 * nó lùi về ngày hôm trước ngay khi đổi sang giờ máy.
 */
export function parseLocalDate(value: string | null | undefined): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  // Backend lưu MỐC THỜI GIAN theo UTC nhưng trả chuỗi trần, không có `Z` hay
  // `+07:00`. Không gắn `Z` vào thì trình duyệt hiểu là giờ máy và mọi mốc lệch
  // đúng 7 tiếng (nhật ký thao tác, thông báo…). Chuỗi chỉ có NGÀY thì để yên:
  // ngày trần không mang múi giờ, quy đổi là dễ lệch mất một ngày.
  const hasTime = /\d{2}:\d{2}/.test(value)
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
  const date = new Date(hasTime && !hasZone ? `${value}Z` : value)
  return Number.isNaN(date.getTime()) ? null : date
}
