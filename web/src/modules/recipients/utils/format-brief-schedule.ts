/** Câu ngắn cho cột «Bản tin»: giờ sáng / cuối ngày, ô rỗng = không gửi buổi đó. */
export function formatBriefSchedule(morning: string | null | undefined, evening: string | null | undefined): string {
  const parts = [morning?.trim() && `Sáng ${morning.trim()}`, evening?.trim() && `Chiều ${evening.trim()}`].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Không gửi'
}
