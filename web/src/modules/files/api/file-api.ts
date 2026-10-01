import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { FileRecord, FileText } from '../types/file'

export const FILES_API_PATH = '/api/files'

export const fileApi = {
  /** Đưa tệp lỗi / tệp của nhóm chưa bật lấy file vào hàng tải về kho. */
  retry: async (id: number) => {
    const res = await httpClient.post<SuccessEnvelope<FileRecord>>(`${FILES_API_PATH}/${id}/retry`)
    return { data: res.data.data, message: res.data.message ?? 'Đã đưa vào hàng tải' }
  },
  /** Bóc chữ ngay (cùng bộ đọc với bot; pdf / ảnh nhờ mô hình). */
  extract: async (id: number) => {
    const res = await httpClient.post<SuccessEnvelope<FileRecord>>(`${FILES_API_PATH}/${id}/extract`)
    return { data: res.data.data, message: res.data.message ?? 'Đã đọc' }
  },
  text: (id: number) => apiGet<FileText>(`${FILES_API_PATH}/${id}/text`),
}
