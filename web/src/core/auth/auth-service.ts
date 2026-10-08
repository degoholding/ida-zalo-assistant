import { apiGet, apiPost } from '@/core/api'
import type { AuthConfig, AuthUser, LoginCredentials, LoginResponse } from './auth-types'

/** Lời gọi API thuần của auth — không giữ state, state nằm ở `auth-store`. */
export const authService = {
  /** Màn đăng nhập hỏi máy chủ có bật nút Google không (Client ID đọc lúc chạy, không nướng vào bản build). */
  config: () => apiGet<AuthConfig>('/api/auth/config'),
  login: (credentials: LoginCredentials) =>
    apiPost<LoginResponse>('/api/auth/login', credentials, { _silent: true } as never),
  /** `credential` = ID token Google Identity Services trả cho nút đăng nhập; máy chủ kiểm chữ ký + email. */
  loginGoogle: (credential: string) =>
    apiPost<LoginResponse>('/api/auth/google', { credential }, { _silent: true } as never),
  /** Xóa phiên phía máy chủ. Lỗi mạng thì kệ, phía trình duyệt vẫn coi như đã thoát. */
  logout: () => apiPost<null>('/api/auth/logout', null, { _silent: true } as never),
  me: () => apiGet<AuthUser>('/api/auth/me'),
}
