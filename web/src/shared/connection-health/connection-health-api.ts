import { apiGet, apiPost } from '@/core/api'
import type { BotAccountHealth, GoogleHealthStatus } from './connection-health'

/**
 * Hai đường ĐÃ CÓ của màn Cài đặt / Tài khoản bot, gọi lại cho chấm trạng thái ở menu — không thêm đường mới. Cả hai đều
 * chỉ quản trị đọc được ở máy chủ (`/api/google/oauth/status` không khai trong bảng quyền → setting.write; `/api/accounts`
 * → bot_account.read chỉ quản trị), nên hook chỉ bật khi người này có quyền cài đặt.
 */
export const connectionHealthApi = {
  googleStatus: () => apiGet<GoogleHealthStatus>('/api/google/oauth/status'),
  /** Cùng luồng với nút "Kết nối Google" ở Cài đặt: lấy `auth_url` rồi điều hướng CẢ TRÌNH DUYỆT sang Google. */
  startGoogleOauth: () => apiPost<{ auth_url: string }>('/api/google/oauth/start'),
  accounts: async () => (await apiGet<{ total: number; items: BotAccountHealth[] }>('/api/accounts', { params: { page_size: 100 } })).items,
}
