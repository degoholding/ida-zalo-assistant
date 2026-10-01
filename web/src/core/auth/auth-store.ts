import { create } from 'zustand'

import { queryClient } from '@/core/api'
import { authEvents } from './auth-events'
import { authService } from './auth-service'
import type { AuthUser, LoginCredentials } from './auth-types'

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
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
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

  login: async (credentials) => {
    set({ isLoggingIn: true })
    try {
      const { user } = await authService.login(credentials)
      set({ user, status: 'signed-in' })
    } finally {
      set({ isLoggingIn: false })
    }
  },

  logout: () => {
    void authService.logout().catch(() => {})
    // Xóa cache React Query: người kế tiếp trên cùng máy không thấy dữ liệu của phiên trước
    queryClient.clear()
    set({ user: null, status: 'signed-out' })
  },
}))

// Máy chủ báo hết phiên ở bất kỳ lời gọi nào → về trạng thái chưa đăng nhập
authEvents.onSessionExpired(() => {
  queryClient.clear()
  useAuthStore.setState({ user: null, status: 'signed-out' })
})
