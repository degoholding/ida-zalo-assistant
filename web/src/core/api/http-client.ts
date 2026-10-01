import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { toast } from 'sonner'

import { authEvents } from '@/core/auth/auth-events'
import { env } from '@/core/config/env'
import { extractErrorMessage } from './response-envelope'

/** Cờ nội bộ gắn thêm vào config của từng request. */
interface RequestConfig extends InternalAxiosRequestConfig {
  /** Tự xử lý lỗi, đừng bật toast tự động. */
  _silent?: boolean
}

/**
 * Bot trợ lý đăng nhập bằng COOKIE PHIÊN `HttpOnly` (máy chủ đặt lúc /api/auth/login), không dùng
 * access/refresh token lưu trong localStorage như ERP: JavaScript không đọc được cookie đó nên một
 * lỗ XSS không lấy được phiên. Mọi lời gọi chỉ cần gửi kèm cookie — cùng gốc nên mặc định đã gửi.
 */
export const httpClient = axios.create({
  baseURL: env.apiUrl,
  withCredentials: true,
  paramsSerializer: { indexes: null },
})

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const config = error.config as RequestConfig | undefined

    // Hết phiên (máy chủ khởi động lại, quá 12 giờ) → store xóa hồ sơ, router đá về /login.
    // Bỏ qua chính các lời gọi /auth/ — sai mật khẩu ở màn đăng nhập không phải "hết phiên".
    if (error.response?.status === 401 && !config?.url?.includes('/auth/')) {
      authEvents.emitSessionExpired()
      return Promise.reject(error)
    }

    const method = (config?.method ?? 'get').toLowerCase()
    if (method !== 'get' && !config?._silent) {
      toast.error(extractErrorMessage(error))
    }

    return Promise.reject(error)
  },
)
