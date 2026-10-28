/** Chỉ mở link http / https (máy chủ đã lọc, đây là chốt thứ hai) — thứ khác hiện chữ thường, không bấm được. */
export function isOpenableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
