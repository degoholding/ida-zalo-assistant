import { downloadFile, httpClient, type SuccessEnvelope } from '@/core/api'
import type { CatalogActionRequest, CatalogEntryDetail, CatalogImportSummary } from '../types/catalog'

export const CATALOG_API_PATH = '/api/catalog'
export const CATALOG_TEMPLATE_FILE_NAME = 'mau-danh-muc-nv-dl.xlsx'

/** Lấy cả phong bì để đọc `message`; lỗi thì `http-client` tự bật toast đỏ. */
export const catalogApi = {
  downloadTemplate: () => downloadFile(`${CATALOG_API_PATH}/template.xlsx`, CATALOG_TEMPLATE_FILE_NAME),
  /** Gửi nguyên tệp .xlsx (thân thô) — máy chủ Node không có bộ đọc multipart. */
  importFile: async (file: File) => {
    const res = await httpClient.post<SuccessEnvelope<CatalogImportSummary>>(`${CATALOG_API_PATH}/import`, file, {
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    return res.data.data
  },
  rematch: async () => {
    const res = await httpClient.post<SuccessEnvelope<Omit<CatalogImportSummary, 'created' | 'updated' | 'errors'>>>(`${CATALOG_API_PATH}/rematch`)
    return res.data.data
  },
  runAction: async (id: number, request: CatalogActionRequest) => {
    const res = await httpClient.post<SuccessEnvelope<CatalogEntryDetail>>(`${CATALOG_API_PATH}/${id}/actions`, request)
    return { detail: res.data.data, message: res.data.message }
  },
}
