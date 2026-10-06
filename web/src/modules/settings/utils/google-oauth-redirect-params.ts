/**
 * Sau khi người dùng đồng ý quyền trên Google, máy chủ đưa trình duyệt về
 * `/app/settings?tab=google&google_oauth=connected` (hoặc `...&google_oauth=error&message=<câu lỗi>`).
 * Hai hàm dưới đây tách phần đọc/xóa param ra khỏi hook để test không cần dựng router.
 */

export type GoogleOauthRedirectStatus = 'connected' | 'error'

export interface GoogleOauthRedirectResult {
  status: GoogleOauthRedirectStatus
  /** Câu lỗi tiếng Việt máy chủ gửi kèm — rỗng thì hook tự có câu mặc định. */
  message: string | null
}

/** Đọc `google_oauth` (+ `message` nếu có) — trả `null` khi URL không có kết quả OAuth nào. */
export function parseGoogleOauthRedirectParams(params: URLSearchParams): GoogleOauthRedirectResult | null {
  const status = params.get('google_oauth')
  if (status !== 'connected' && status !== 'error') return null
  return { status, message: params.get('message') }
}

/** Trả về bản sao ĐÃ XÓA `google_oauth` / `message` — giữ nguyên các param khác (vd `tab`). */
export function clearGoogleOauthRedirectParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('google_oauth')
  next.delete('message')
  return next
}
