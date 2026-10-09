import { extractErrorMessage } from '@/core/api'

/**
 * Câu hiện ở bảng khi tải danh sách lỗi. 422 = máy chủ từ chối CHÍNH yêu cầu này và tự viết câu
 * hướng dẫn tiếng Việt (vd màn Tìm tin: «Tìm lâu quá — thêm từ khóa cụ thể hơn…») → hiện đúng
 * câu đó. Lỗi khác (mạng, 5xx, quyền) → `undefined` để bảng dùng câu mặc định «Không tải được
 * danh sách…» — đổi câu đó thành câu kỹ thuật của máy chủ chỉ làm người dùng rối thêm.
 */
export function describeListError(error: unknown): string | undefined {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  return status === 422 ? extractErrorMessage(error) : undefined
}
