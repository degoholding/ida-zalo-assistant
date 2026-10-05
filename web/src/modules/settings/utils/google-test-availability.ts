export interface GoogleTestAvailability {
  disabled: boolean
  /** Lý do khóa nút — hiện cạnh nút để người dùng biết phải làm gì trước. `null` khi mở. */
  reason: string | null
}

/**
 * Nút «Kiểm tra kết nối» dùng giá trị ĐÃ LƯU trên máy chủ (không phải chữ đang
 * gõ dở trên form) — cần CẢ khóa service account lẫn link trang tính đã đặt,
 * thiếu một trong hai thì gọi chắc chắn lỗi 422 mà không cần ra mạng.
 */
export function getGoogleTestAvailability(settings: {
  serviceAccountSet: boolean
  spreadsheetUrlSet: boolean
}): GoogleTestAvailability {
  if (!settings.serviceAccountSet && !settings.spreadsheetUrlSet) {
    return { disabled: true, reason: 'Chưa dán khóa service account và chưa có link trang tính' }
  }
  if (!settings.serviceAccountSet) return { disabled: true, reason: 'Chưa dán khóa service account' }
  if (!settings.spreadsheetUrlSet) return { disabled: true, reason: 'Chưa có link trang tính' }
  return { disabled: false, reason: null }
}
