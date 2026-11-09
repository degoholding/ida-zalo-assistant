import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { ImportResultRow, SeatInfo } from '../types/import'

export const importApi = {
  /** Trạng thái ghế đồng bộ Zalo PC (phase 14.6); QR lấy ở `/api/imports/seat/qr.png`. */
  seat: () => apiGet<SeatInfo>('/api/imports/seat'),
  /** Đăng xuất tài khoản khỏi ghế (trả suất PC); sync-once thấy ghế về trang QR thì tắt container. */
  seatLogout: async () => {
    const res = await httpClient.post<SuccessEnvelope<{ result: string }>>('/api/imports/seat/logout')
    return res.data.message ?? 'Đã đăng xuất ghế'
  },
  results: () => apiGet<ImportResultRow[]>('/api/imports/results'),
}

export const SEAT_QR_URL = '/api/imports/seat/qr.png'
