import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { ImportResultRow, SeatInfo, SeatLauncherInfo } from '../types/import'

export const importApi = {
  /** Trạng thái ghế đồng bộ Zalo PC (phase 14.6) + dịch vụ bật ghế (14.9); QR lấy ở `/api/imports/seat/qr.png`. */
  seat: () => apiGet<SeatInfo>('/api/imports/seat'),
  /** Đăng xuất tài khoản khỏi ghế (trả suất PC); sync-once thấy ghế về trang QR thì tắt container. */
  seatLogout: async () => {
    const res = await httpClient.post<SuccessEnvelope<{ result: string }>>('/api/imports/seat/logout')
    return res.data.message ?? 'Đã đăng xuất ghế'
  },
  /** Bật ghế cho một tài khoản (tên thư mục dữ liệu trên máy chủ) — chỉ Quản trị. */
  seatStart: async (account: string) => {
    const res = await httpClient.post<SuccessEnvelope<SeatLauncherInfo>>('/api/imports/seat/start', { account })
    return { data: res.data.data, message: res.data.message ?? 'Đã bật ghế' }
  },
  seatStop: async () => {
    const res = await httpClient.post<SuccessEnvelope<SeatLauncherInfo>>('/api/imports/seat/stop')
    return { data: res.data.data, message: res.data.message ?? 'Đã tắt ghế' }
  },
  results: () => apiGet<ImportResultRow[]>('/api/imports/results'),
}

export const SEAT_QR_URL = '/api/imports/seat/qr.png'
