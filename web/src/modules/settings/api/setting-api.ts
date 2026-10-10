import { apiGet, apiPost, httpClient, type SuccessEnvelope } from '@/core/api'
import type { DriveTestResult, GoogleTestResult, SettingView } from '../types/setting'

export const settingApi = {
  list: () => apiGet<SettingView[]>('/api/settings'),
  /** Thân chỉ gồm các khóa thật sự đổi (`pickDirtySettings` lọc trước khi gọi tới đây). */
  save: async (changes: Record<string, unknown>) => {
    const res = await httpClient.patch<SuccessEnvelope<SettingView[]>>('/api/settings', changes)
    return { data: res.data.data, message: res.data.message ?? 'Đã lưu cài đặt' }
  },
  /** Xóa giá trị web của một khóa — quay về `.env` / mặc định. */
  reset: async (key: string) => {
    const res = await httpClient.post<SuccessEnvelope<SettingView[]>>(`/api/settings/${encodeURIComponent(key)}/reset`)
    return { data: res.data.data, message: res.data.message ?? 'Đã khôi phục mặc định' }
  },
  testGoogleConnection: () => apiPost<GoogleTestResult>('/api/settings/google/test'),
  /** «Kiểm tra thư mục» của khối «Recap họp tự động» — đọc qua Gmail đã «Kết nối Google», không phải service account. */
  testDriveFolder: () => apiPost<DriveTestResult>('/api/settings/google/drive-test'),
}
