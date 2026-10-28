/** Số đếm có dấu chấm ngăn nghìn kiểu Việt Nam (1.234.567). */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('vi-VN') : '0'
}

/** Thời gian: dưới 1 giây ghi ms, từ 1 giây ghi giây một chữ số lẻ (1,5 giây). */
export function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 ms'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây`
}

/** Tỷ lệ lỗi (lỗi hệ thống + bị chặn + quá nhịp) trên tổng lượt, làm tròn một chữ số; 0 lượt thì 0%. */
export function failureRate(counts: { calls: number; errors: number; rejected: number; rate_limited: number }): string {
  if (!counts.calls) return '0%'
  const rate = ((counts.errors + counts.rejected + counts.rate_limited) / counts.calls) * 100
  return `${rate.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}
