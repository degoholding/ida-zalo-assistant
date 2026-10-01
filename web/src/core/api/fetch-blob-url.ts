import { httpClient } from './http-client'

/**
 * Tải nội dung tệp qua đường CÓ KIỂM QUYỀN rồi trả về một `blob:` URL để NHÚNG
 * thẳng vào trang (`<img src>`, `<iframe src>`).
 *
 * Cùng lý do với `downloadFile`: `<img src="/api/attachments/1/view">` thì trình
 * duyệt tự đi lấy và **không gắn token Bearer** — tới nơi là 401. Phải lấy bằng
 * `httpClient` rồi mới dựng liên kết tạm trong bộ nhớ.
 *
 * ⚠️ Người gọi **phải tự thu hồi** bằng `URL.revokeObjectURL` khi đóng khung
 * xem; blob nằm lại trong bộ nhớ tới lúc đóng tab, vài tệp 30MB là thấy ngay.
 * Không tự thu hồi ở đây được vì URL còn phải sống suốt thời gian đang xem.
 */
export async function fetchBlobUrl(url: string): Promise<string> {
  const response = await httpClient.get<Blob>(url, { responseType: 'blob' })
  return URL.createObjectURL(response.data)
}
