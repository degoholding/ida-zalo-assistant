import { apiGet, apiPost } from '@/core/api'
import type { AuthUser, LoginCredentials, LoginResponse } from './auth-types'

/** Lời gọi API thuần của auth — không giữ state, state nằm ở `auth-store`. */
export const authService = {
  login: (credentials: LoginCredentials) =>
    apiPost<LoginResponse>('/api/auth/login', credentials, { _silent: true } as never),
  /** Xóa phiên phía máy chủ. Lỗi mạng thì kệ, phía trình duyệt vẫn coi như đã thoát. */
  logout: () => apiPost<null>('/api/auth/logout', null, { _silent: true } as never),
  me: () => apiGet<AuthUser>('/api/auth/me'),
}
