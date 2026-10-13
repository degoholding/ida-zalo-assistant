/** Tình trạng lượt đọc nguồn số liệu — khớp `MetricSourceStatus` ở `src/constants.ts`; đổi bên đó thì sửa tay bên này. */
export const METRIC_SOURCE_STATUS = { neverRun: 0, ok: 1, failed: 2, mappingError: 3 } as const

/** Cờ dòng số liệu (BIT, cộng được) — khớp `MetricFlag` ở `src/constants.ts`. */
export const METRIC_FLAG = { negative: 1, deviation: 2, unparsed: 4, unknownStaff: 8 } as const

export const METRIC_SOURCE_STATUS_OPTIONS = [
  { value: METRIC_SOURCE_STATUS.neverRun, label: 'Chưa đọc' },
  { value: METRIC_SOURCE_STATUS.ok, label: 'Đọc tốt' },
  { value: METRIC_SOURCE_STATUS.failed, label: 'Không đọc được' },
  { value: METRIC_SOURCE_STATUS.mappingError, label: 'Lỗi ánh xạ cột' },
]

export const METRIC_FLAG_OPTIONS = [
  { value: METRIC_FLAG.negative, label: 'Số âm' },
  { value: METRIC_FLAG.deviation, label: 'Lệch quá 30% so kỳ trước' },
  { value: METRIC_FLAG.unparsed, label: 'Ô không đọc được' },
  { value: METRIC_FLAG.unknownStaff, label: 'Nhân viên ngoài danh mục' },
]

export function getMetricSourceStatusLabel(status: number): string {
  return METRIC_SOURCE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? ''
}

/** Nhãn từng cờ đang bật trong số `flags` (bit cộng). */
export function getMetricFlagLabels(flags: number): string[] {
  return METRIC_FLAG_OPTIONS.filter((option) => (flags & option.value) !== 0).map((option) => option.label)
}

export type MetricGroupBy = 'staff' | 'area' | 'date'

export const METRIC_GROUP_BY_OPTIONS: { value: MetricGroupBy; label: string }[] = [
  { value: 'staff', label: 'Nhân viên' },
  { value: 'area', label: 'Khu vực' },
  { value: 'date', label: 'Ngày' },
]

/** Chỉ tiêu của các nguồn đang bật — `GET /api/metrics/catalog`. */
export interface MetricCatalogItem {
  code: string
  label: string
  unit: string
  aggregate: 'sum' | 'last'
  source_id: number
  source_name: string
  last_ok_at: string | null
}

export interface MetricCatalog {
  metrics: MetricCatalogItem[]
  areas: { key: string; name: string }[]
  staff: { id: number; name: string; region: string }[]
}

export interface MetricSummaryRow {
  key: string
  label: string
  value: number
  previous: number | null
  change_pct: number | null
  flag_count: number
}

/** `GET /api/metrics/summary` */
export interface MetricSummary {
  rows: MetricSummaryRow[]
  previous_period: { from: string; to: string } | null
  total: { value: number; previous: number | null; change_pct: number | null; flag_count: number }
  /** Tổng chỉ có nghĩa khi lọc đúng một chỉ tiêu */
  single_metric: boolean
  unit: string
  sources: string[]
  last_ok_at: string | null
}

export interface MetricSummaryQuery {
  metric: string
  from: string
  to: string
  area: string
  staff: string
  group_by: MetricGroupBy
}

/** Một dòng số liệu — `GET /api/metrics/values`. */
export interface MetricValueRow extends Record<string, unknown> {
  id: number
  metric_date: string
  source_id: number
  source_name: string
  staff_name: string
  catalog_entry_id: number | null
  area_key: string
  area_name: string
  metric_code: string
  metric_label: string
  unit: string
  value: number | null
  raw_text: string
  flags: number
  sheet_row: number
}

export interface MissingReporter {
  id: number
  code: string
  name: string
  region: string
  manager: string
}

/** `GET /api/metrics/missing` */
export interface MetricMissing {
  date: string
  /** false = chưa tới 18:00 (hoặc chưa có nguồn «báo hằng ngày») nên chưa kết luận */
  ready: boolean
  missing: MissingReporter[]
  late: MissingReporter[]
}

export interface MetricMappingDef {
  code: string
  label: string
  column: string
  unit: string
  aggregate: 'sum' | 'last'
}

/** Ánh xạ cột — dạng lưu ở máy chủ (khóa snake_case, khớp `validateMapping`). */
export interface MetricMapping {
  date: string
  staff: string
  staff_by: 'name' | 'code'
  area: string
  metrics: MetricMappingDef[]
}

/** Nguồn số liệu — `GET /api/metric-sources[/:id]`. */
export interface MetricSource extends Record<string, unknown> {
  id: number
  name: string
  spreadsheet_id: string
  spreadsheet_url: string
  sheet_title: string
  header_row: number
  mapping: MetricMapping | null
  metric_count: number
  daily_report: boolean
  is_active: boolean
  status: number
  last_sync_at: string | null
  last_ok_at: string | null
  last_error: string
  last_row_count: number
  last_warning_count: number
  last_warnings: string[]
  service_account_email?: string
}

export interface MetricPreviewSample {
  row: number
  date: string
  staff_name: string
  area_name: string
  code: string
  value: number | null
  raw: string
  flags: number
  in_catalog: boolean
}

/** `POST /api/metric-sources/preview` */
export interface MetricPreview {
  ok: boolean
  status: number
  error: string
  headers: string[]
  matched: { label: string; code: string; column: string }[]
  sample: MetricPreviewSample[]
  record_count: number
  sheet_rows: number
  out_of_window: number
  warnings: string[]
  warning_total: number
}

export interface MetricSyncResult {
  records: number
  removed: number
  warnings: string[]
  warning_total: number
}
