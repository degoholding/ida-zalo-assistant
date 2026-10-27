const pad = (n: number) => String(n).padStart(2, '0')
const toIsoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Khoảng mặc định của màn "Số liệu": từ thứ Hai tuần này đến hôm nay (giờ máy = giờ Việt Nam), dạng YYYY-MM-DD. */
export function getThisWeekRange(now: Date = new Date()): { from: string; to: string } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sinceMonday = (monday.getDay() + 6) % 7
  monday.setDate(monday.getDate() - sinceMonday)
  return { from: toIsoDay(monday), to: toIsoDay(now) }
}

export function getTodayIso(now: Date = new Date()): string {
  return toIsoDay(now)
}
