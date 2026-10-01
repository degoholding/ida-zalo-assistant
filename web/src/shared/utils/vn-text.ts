/**
 * So khớp chữ tiếng Việt KHÔNG phân biệt dấu và hoa thường.
 *
 * Người Việt gõ ô tìm thường không bỏ dấu — "nghi phep", "phap nhan", "tang 3".
 * So thô thì "tang" không khớp "Tầng" và người dùng kết luận là danh mục không
 * có mục đó, dù nó nằm ngay đấy (khách báo 25/08/2026 với loại văn bản «Giấy
 * nghỉ phép»; đo lại 04/09/2026 ở hộp chọn phòng họp: gõ "tang 3" ra 0 phòng
 * trong khi có 4).
 *
 * `normalize('NFD')` tách dấu thành ký tự tổ hợp riêng rồi xóa chúng đi. Riêng
 * **đ / Đ** không phải chữ d có dấu nên NFD không đụng tới, phải thay tay.
 *
 * Chỉ dùng để SO, không đụng tới chuỗi hiện ra — nhãn vẫn nguyên dấu.
 */
export function stripDiacritics(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * `haystack` có chứa `needle` không, bỏ qua dấu và hoa thường.
 *
 * Nhận cả mảng cho tiện: một mục thường có nhiều ô để tìm (tên · mã · vị trí ·
 * thiết bị), và chỗ gọi nào cũng viết lại vòng `some` là chép cùng một luật.
 */
export function matchesVietnamese(
  haystack: string | (string | null | undefined)[],
  needle: string,
): boolean {
  const kw = stripDiacritics(needle.trim())
  if (!kw) return true
  const fields = Array.isArray(haystack) ? haystack : [haystack]
  return fields.some((f) => stripDiacritics(f || '').includes(kw))
}
