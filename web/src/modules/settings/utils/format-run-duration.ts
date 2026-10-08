/**
 * Thời gian chạy của một lượt: `350 ms` · `4,2 giây` · `3 phút 5 giây` · `1 giờ 2 phút`.
 * Số âm / không phải số (dữ liệu hỏng) trả rỗng để ô hiện trống thay vì «-5 ms».
 */
export function formatRunDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây`
  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const rest = totalSeconds % 60
  if (hours > 0) return minutes ? `${hours} giờ ${minutes} phút` : `${hours} giờ`
  return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`
}
