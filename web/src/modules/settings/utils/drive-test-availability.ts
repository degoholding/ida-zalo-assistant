export interface DriveTestAvailability {
  disabled: boolean
  /** Lý do khóa nút — hiện cạnh nút để người dùng biết phải làm gì trước. `null` khi mở. */
  reason: string | null
}

/**
 * Nút «Kiểm tra thư mục» cần CẢ BA: đã kết nối Google (Calendar & Meet), đã tick quyền đọc Drive lúc đồng ý,
 * và đã lưu link thư mục — thiếu một trong ba thì gọi chắc chắn lỗi 422 mà không cần ra mạng.
 */
export function getDriveTestAvailability(settings: {
  connected: boolean
  driveScopeGranted: boolean
  folderSet: boolean
}): DriveTestAvailability {
  if (!settings.connected) return { disabled: true, reason: 'Chưa kết nối Google — kết nối ở mục Calendar & Meet phía trên' }
  if (!settings.driveScopeGranted) {
    return { disabled: true, reason: 'Chưa có quyền đọc Drive — bấm «Kết nối lại» ở mục Calendar & Meet và tick thêm quyền Drive' }
  }
  if (!settings.folderSet) return { disabled: true, reason: 'Chưa có link thư mục ghi âm' }
  return { disabled: false, reason: null }
}
