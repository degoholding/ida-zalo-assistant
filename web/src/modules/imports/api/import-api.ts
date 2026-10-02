import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { ExportTarget, ImportSummary } from '../types/import'

export const importApi = {
  /** Gửi nguyên tệp JSON (thân thô) — máy chủ Node không có bộ đọc multipart. */
  zaloWeb: async (file: File) => {
    const res = await httpClient.post<SuccessEnvelope<ImportSummary>>('/api/imports/zalo-web', file, {
      headers: { 'Content-Type': 'application/json' },
    })
    return { data: res.data.data, message: res.data.message ?? 'Đã nhập' }
  },
  targets: () => apiGet<ExportTarget[]>('/api/imports/zalo-web/targets'),
}
