import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDate } from '@/shared/utils/format-date'
import { METRIC_VALUES_API_PATH } from '../api/metric-api'
import { MetricFlagChips } from '../components/metric-flag-chips'
import { METRIC_FLAG_OPTIONS, type MetricValueRow } from '../types/metric'
import { formatMetricNumber } from '../utils/format-metric-number'

/** Cột "Chi tiết" — `key` cột sắp xếp PHẢI trùng `sorts` của `METRIC_VALUE_LIST_SPEC` (`src/web/api/metrics-api.ts`). */
export const METRIC_VALUE_COLUMNS: DataTableColumn<MetricValueRow>[] = [
  { key: 'metric_date', header: 'Ngày', width: 110, sortable: true, sortDescFirst: true, cell: (row) => formatDate(row.metric_date) },
  { key: 'staff_name', header: 'Nhân viên', width: 180, sortable: true, hideable: false, wrap: true, cell: (row) => row.staff_name || '—' },
  { key: 'area_name', header: 'Khu vực', width: 150, sortable: true, cell: (row) => row.area_name || '—' },
  { key: 'metric_code', header: 'Chỉ tiêu', width: 160, sortable: true, cell: (row) => row.metric_label },
  {
    key: 'value', header: 'Giá trị', width: 140, align: 'right', sortable: true,
    cell: (row) => <span className="font-medium">{formatMetricNumber(row.value)}{row.unit ? ` ${row.unit}` : ''}</span>,
  },
  { key: 'raw_text', header: 'Chữ gốc', width: 130, cell: (row) => <span className="text-muted-foreground">{row.raw_text || '—'}</span> },
  { key: 'flags', header: 'Cờ', width: 240, cell: (row) => <MetricFlagChips flags={row.flags} /> },
  { key: 'sheet_row', header: 'Dòng bảng', width: 90, align: 'right', defaultHidden: true, cell: (row) => row.sheet_row || '—' },
  { key: 'source_name', header: 'Nguồn', width: 160, defaultHidden: true, cell: (row) => row.source_name },
]

/** Tab "Chi tiết": chỉ xem (không thêm / sửa tay — số do bot đọc từ bảng), lọc theo ngày và cờ. */
export const metricValueCrudConfig: CrudConfig<MetricValueRow> = {
  entity: 'metric',
  title: 'Số liệu',
  description: 'Từng số bot đã đọc từ bảng Google Sheets. Chỉ xem — muốn sửa số thì sửa trong bảng, bot sẽ đọc lại.',
  unitLabel: 'dòng số liệu',
  apiPath: METRIC_VALUES_API_PATH,
  emptyMessage: 'Chưa có số liệu nào — cấu hình nguồn ở màn Nguồn số liệu rồi bấm "Đọc ngay".',
  storageKey: 'metrics.values',
  searchParam: 'q',
  searchPlaceholder: 'Tìm nhân viên, khu vực, chữ gốc',
  defaultSort: { by: 'metric_date', dir: 'desc' },
  quickFilters: [
    {
      key: 'flags',
      label: 'Cờ',
      type: 'select',
      options: METRIC_FLAG_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
    },
  ],
  columns: METRIC_VALUE_COLUMNS,
  filterConfig: {
    // `tab` nằm trên URL của trang "Số liệu" — bấm "Áp dụng" không được quét mất nó
    preserveParams: ['tab'],
    allowConjunctionToggle: true,
    fields: [
      { name: 'metric_date', label: 'Ngày', type: 'date' },
      { name: 'metric_code', label: 'Mã chỉ tiêu', type: 'text' },
      { name: 'area_key', label: 'Mã khu vực', type: 'text' },
    ],
  },
  listRoute: appRoutes.metrics.list,
  getItemName: (row) => `${row.staff_name} · ${row.metric_label}`,
  formFields: [],
  readOnlyDetail: true,
}
