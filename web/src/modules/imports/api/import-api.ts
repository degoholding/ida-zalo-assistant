import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { ExportTarget, ImportFilesMode, ImportResultRow, ImportSummary, SeatInfo } from '../types/import'

export const importApi = {
  /** Gửi nguyên tệp JSON (thân thô) — máy chủ Node không có bộ đọc multipart. `files`: tệp đính kèm của tin nhập (phase 14.8). */
  zaloWeb: async (file: File, files: ImportFilesMode = 'images_pdf') => {
    const res = await httpClient.post<SuccessEnvelope<ImportSummary>>(`/api/imports/zalo-web?files=${files}`, file, {
      headers: { 'Content-Type': 'application/json' },
    })
    return { data: res.data.data, message: res.data.message ?? 'Đã nhập' }
  },
  targets: () => apiGet<ExportTarget[]>('/api/imports/zalo-web/targets'),
  /** Trạng thái ghế đồng bộ Zalo PC (phase 14.6); QR lấy ở `/api/imports/seat/qr.png`. */
  seat: () => apiGet<SeatInfo>('/api/imports/seat'),
  results: () => apiGet<ImportResultRow[]>('/api/imports/results'),
}

export const SEAT_QR_URL = '/api/imports/seat/qr.png'
