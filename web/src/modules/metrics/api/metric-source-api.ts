import { apiGet, apiPost } from '@/core/api'
import type { MetricPreview, MetricSyncResult } from '../types/metric'

export const METRIC_SOURCES_API_PATH = '/api/metric-sources'

export type MetricSourceAction = 'enable' | 'disable' | 'sync_now'

/** Cấu hình ĐANG GÕ (chưa lưu) gửi đi đọc thử. */
export interface MetricPreviewRequest {
  source_id?: number
  spreadsheet_url: string
  sheet_title: string
  header_row: number
  mapping: unknown
}

export const metricSourceApi = {
  /** Email service account (không phải khóa) — lấy từ trang đầu của danh sách. */
  serviceAccountEmail: async () =>
    (await apiGet<{ service_account_email: string }>(METRIC_SOURCES_API_PATH, { params: { page_size: 1 } })).service_account_email,
  runAction: (id: number, action: MetricSourceAction) =>
    apiPost<MetricSyncResult | Record<string, unknown>>(`${METRIC_SOURCES_API_PATH}/${id}/actions`, { action }),
  preview: (request: MetricPreviewRequest) => apiPost<MetricPreview>(`${METRIC_SOURCES_API_PATH}/preview`, request),
}
