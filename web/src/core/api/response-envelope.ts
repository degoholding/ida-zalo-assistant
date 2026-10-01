/**
 * Backend FastAPI bọc MỌI response trong một "phong bì" thống nhất:
 *   thành công: { success: true,  message, data }
 *   thất bại:   { success: false, error: { code, message, details } }
 * Kể cả HTTPException và lỗi validate cũng được global handler ép về dạng này.
 */

export interface SuccessEnvelope<T> {
  success: true
  message?: string
  data: T
}

export interface ErrorEnvelope {
  success: false
  error: { code?: string; message: string; details?: unknown }
}

export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope

//  Câu trơn của backend trước bao-CR-538 — gặp câu này mới cần ghép `details`.
const LEGACY_VALIDATION_MESSAGE = 'Dữ liệu không hợp lệ'

/**
 * Thông điệp lỗi ưu tiên: error.message > message > message của axios > câu mặc định.
 *
 * bao-CR-538: backend nay tự viết câu tiếng Việt chỉ đúng ô sai cho lỗi 422 (vd «Ô "Mục đích"
 * tối đa 355 ký tự (đang nhập 412)»), nên KHÔNG nối thêm `details` tiếng Anh của Pydantic nữa.
 * Chỉ khi backend cũ còn trả câu trơn «Dữ liệu không hợp lệ» mới ghép `details` cho đỡ mù.
 */
export function extractErrorMessage(error: unknown): string {
  const fallback = 'Có lỗi xảy ra, vui lòng thử lại'
  if (!error || typeof error !== 'object') return fallback

  const err = error as {
    response?: {
      data?: Partial<ErrorEnvelope> & {
        message?: string
        error?: {
          code?: string
          message?: string
          details?: unknown
        }
      }
    }
    message?: string
  }

  const errObj = err.response?.data?.error
  const legacyMessage = !errObj?.message || errObj.message === LEGACY_VALIDATION_MESSAGE
  if (legacyMessage && errObj?.details && Array.isArray(errObj.details) && errObj.details.length > 0) {
    const detailMsgs = errObj.details
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc)
          ? d.loc.filter((x) => x !== 'body').join('.')
          : ''
        return field ? `${field}: ${d.msg}` : d.msg || ''
      })
      .filter(Boolean)
    if (detailMsgs.length > 0) {
      return `${errObj.message || LEGACY_VALIDATION_MESSAGE} (${detailMsgs.join('; ')})`
    }
  }

  return (
    errObj?.message ||
    err.response?.data?.message ||
    err.message ||
    fallback
  )
}
