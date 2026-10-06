import { apiGet, apiPost } from '@/core/api'
import type { GoogleOauthStartResult, GoogleOauthStatus } from '../types/setting'

/**
 * OAuth người dùng cho Google Calendar / Meet — khác hẳn khóa service account
 * của Google Sheets (`setting-api.ts`). Không có thân gửi lên cho cả ba hàm.
 */
export const googleOauthApi = {
  status: () => apiGet<GoogleOauthStatus>('/api/google/oauth/status'),
  /** Trả về `auth_url` — nơi gọi phải điều hướng CẢ TRÌNH DUYỆT sang đó, không phải gọi tiếp API. */
  start: () => apiPost<GoogleOauthStartResult>('/api/google/oauth/start'),
  disconnect: () => apiPost<GoogleOauthStatus>('/api/google/oauth/disconnect'),
}
