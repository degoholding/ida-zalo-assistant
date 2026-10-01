/** Dung lượng tối đa cho một ảnh tải lên (ảnh đại diện, chữ ký). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Kiểm tệp ảnh NGAY Ở TRÌNH DUYỆT trước khi gửi lên.
 *
 * Backend cũng chặn, nhưng chặn sau khi đã tải xong cả tệp: người dùng chọn
 * nhầm một video 80MB thì phải chờ tải hết rồi mới nhận lỗi. Kiểm tại chỗ trả
 * lời tức thì và không tốn đường truyền.
 *
 * Trả `null` khi hợp lệ, ngược lại trả câu báo lỗi đã viết sẵn cho người dùng.
 */
export function validateImageFile(file: File, maxBytes = MAX_IMAGE_BYTES): string | null {
  if (!file.type.startsWith('image/')) {
    return 'Chỉ nhận tệp ảnh (PNG, JPG…).'
  }
  if (file.size > maxBytes) {
    return `Ảnh tối đa ${Math.round(maxBytes / 1024 / 1024)}MB. Hãy chọn ảnh nhẹ hơn.`
  }
  return null
}
