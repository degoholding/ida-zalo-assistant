import { create } from 'zustand'

import { queryClient } from '@/core/api'
import { authEvents } from './auth-events'
import { authService } from './auth-service'
import type { AuthUser, LoginCredentials, LoginResponse } from './auth-types'

/**
 * Trạng thái đăng nhập. Phiên thật là cookie `HttpOnly` ở máy chủ — store chỉ giữ HỒ SƠ để vẽ menu.
 * Lúc mở app chưa biết còn phiên không (`status: 'checking'`) → hỏi `/api/auth/me` một lần.
 */
interface AuthState {
  user: AuthUser | null
  status: 'checking' | 'signed-in' | 'signed-out'
  isLoggingIn: boolean
  checkSession: () => Promise<void>
  login: (credentials: LoginCredentials) => Promise<void>
  /** Đăng nhập bằng ID token của nút Google — xong thì y như đăng nhập mật khẩu. */
  loginGoogle: (credential: string) => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => {
  //  Hai đường đăng nhập chỉ khác lời gọi API; trạng thái chờ và hồ sơ nhận về đi chung một khuôn.
  const signIn = async (request: () => Promise<LoginResponse>) => {
    set({ isLoggingIn: true })
    try {
      const { user } = await request()
      set({ user, status: 'signed-in' })
    } finally {
      set({ isLoggingIn: false })
    }
  }

  return {
    user: null,
    status: 'checking',
    isLoggingIn: false,

    checkSession: async () => {
      try {
        const user = await authService.me()
        set({ user, status: 'signed-in' })
      } catch {
        set({ user: null, status: 'signed-out' })
      }
    },

    login: (credentials) => signIn(() => authService.login(credentials)),

    loginGoogle: (credential) => signIn(() => authService.loginGoogle(credential)),

    logout: () => {
      void authService.logout().catch(() => {})
      // Xóa cache React Query: người kế tiếp trên cùng máy không thấy dữ liệu của phiên trước
      queryClient.clear()
      set({ user: null, status: 'signed-out' })
    },
  }
})

// Máy chủ báo hết phiên ở bất kỳ lời gọi nào → về trạng thái chưa đăng nhập
authEvents.onSessionExpired(() => {
  queryClient.clear()
  useAuthStore.setState({ user: null, status: 'signed-out' })
})
