/** Số liệu hiển thị kiểu Việt (12.345,5), tối đa 2 số lẻ; rỗng → «—». */
export function formatMetricNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
}

/** «+12,5%» / «-3%» / «—» (kỳ trước bằng 0 hoặc không có thì không có %). */
export function formatChangePercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}
