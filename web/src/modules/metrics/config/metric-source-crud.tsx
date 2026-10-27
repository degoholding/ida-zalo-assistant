import { Calendar, CircleCheck, CircleX, Database } from 'lucide-react'

import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDateTime } from '@/shared/utils/format-date'
import { METRIC_SOURCES_API_PATH } from '../api/metric-source-api'
import { MetricMappingField } from '../components/metric-mapping-field'
import { MetricSourceActionButtons } from '../components/metric-source-action-buttons'
import { MetricSourcePreviewPanel } from '../components/metric-source-preview-panel'
import { MetricSourceStatusBadge } from '../components/metric-source-status-badge'
import { MetricSourceStatusPanel } from '../components/metric-source-status-panel'
import { MetricSpreadsheetLinkField } from '../components/metric-spreadsheet-link-field'
import { getMetricSourceStatusLabel, METRIC_SOURCE_STATUS_OPTIONS, type MetricSource } from '../types/metric'
import { createEmptyMapping } from '../utils/validate-metric-mapping'
import { METRIC_SOURCE_CREATE_ROUTE } from './metric-source-routes'

const SECTION_SOURCE = 'Bảng nguồn'
const SECTION_MAPPING = 'Cột và đọc thử'

/** Cột Nguồn số liệu — `key` cột sắp xếp PHẢI trùng `sorts` của `METRIC_SOURCE_LIST_SPEC` (`src/web/api/metric-sources-api.ts`). */
export const METRIC_SOURCE_COLUMNS: DataTableColumn<MetricSource>[] = [
  { key: 'name', header: 'Tên nguồn', width: 200, sortable: true, hideable: false, wrap: true, cell: (source) => source.name },
  { key: 'sheet_title', header: 'Tab', width: 140, cell: (source) => source.sheet_title },
  { key: 'status', header: 'Tình trạng', width: 150, sortable: true, cell: (source) => <MetricSourceStatusBadge status={source.status} isActive={source.is_active} /> },
  { key: 'metric_count', header: 'Chỉ tiêu', width: 90, align: 'right', cell: (source) => source.metric_count },
  { key: 'daily_report', header: 'Báo hằng ngày', width: 120, align: 'center', cell: (source) => (source.daily_report ? 'Có' : 'Không') },
  { key: 'last_ok_at', header: 'Đọc tốt lúc', width: 150, sortable: true, sortDescFirst: true, cell: (source) => formatDateTime(source.last_ok_at) || '—' },
  { key: 'last_error', header: 'Lỗi gần nhất', width: 280, wrap: true, cell: (source) => <span className="text-destructive">{source.last_error || ''}</span> },
  { key: 'last_sync_at', header: 'Lần đọc cuối', width: 150, sortable: true, sortDescFirst: true, defaultHidden: true, cell: (source) => formatDateTime(source.last_sync_at) || '—' },
  { key: 'created_at', header: 'Ngày thêm', width: 150, sortable: true, sortDescFirst: true, defaultHidden: true, cell: (source) => formatDateTime(source.created_at as string) },
]

const YES_NO = [{ value: '1', label: 'Có' }, { value: '0', label: 'Không' }]

export const metricSourceCrudConfig: CrudConfig<MetricSource> = {
  // Quyền: `metric` — Quản trị đủ (kể cả `create` → nút "Thêm" của khung), Quản lý chỉ đọc (và không thấy menu). Chốt thật ở máy
  // chủ: `/api/metric-sources*` chỉ quản trị. Nhật ký máy chủ ghi `metric_source` nên "Lịch sử thao tác" tra theo tên đó.
  entity: 'metric',
  auditEntity: 'metric_source',
  title: 'Nguồn số liệu',
  description: 'Các bảng Google Sheets bot đọc số liệu. Dán link, chọn tab, khai cột rồi "Kiểm tra đọc thử" trước khi lưu.',
  unitLabel: 'nguồn số liệu',
  apiPath: METRIC_SOURCES_API_PATH,
  emptyMessage: 'Chưa có nguồn nào — bấm "Thêm nguồn số liệu" để dán link bảng đầu tiên.',
  storageKey: 'metrics.sources',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên nguồn, tab',
  defaultSort: { by: 'created_at', dir: 'desc' },
  quickFilters: [
    { key: 'status', label: 'Tình trạng', type: 'select', options: METRIC_SOURCE_STATUS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label })) },
    { key: 'is_active', label: 'Đang đọc', type: 'select', options: YES_NO },
    { key: 'daily_report', label: 'Báo hằng ngày', type: 'select', options: YES_NO },
  ],
  columns: METRIC_SOURCE_COLUMNS,
  listRoute: appRoutes.metricSources.list,
  detailRoute: (id) => appRoutes.metricSources.detail(id),
  //  Form dài (ánh xạ cột + đọc thử) → thêm mới ở TRANG riêng (cùng `CrudDetailPage`), không nhồi vào hộp thoại
  createRoute: METRIC_SOURCE_CREATE_ROUTE,
  getItemName: (source) => source.name,
  deleteWarning: 'Xóa nguồn thì toàn bộ số đã đọc từ nguồn này cũng bị xóa. Muốn giữ số cũ thì dùng "Tắt đọc".',
  detailMaxWidth: 'max-w-6xl',
  formSections: {
    [SECTION_SOURCE]: 'Bot đọc bảng bằng service account — nhớ chia sẻ bảng cho email đó (quyền Người xem).',
    [SECTION_MAPPING]: 'Khai cột ngày, nhân viên, khu vực và từng chỉ tiêu; bấm "Kiểm tra đọc thử" để thấy bảng khớp cột nào.',
  },
  formFields: [
    { name: 'name', label: 'Tên nguồn', type: 'text', required: true, section: SECTION_SOURCE, placeholder: 'Báo cáo bán hàng hằng ngày' },
    {
      name: 'spreadsheet_url', label: 'Link bảng', type: 'custom', section: SECTION_SOURCE, defaultValue: '',
      render: ({ control, name, disabled }) => <MetricSpreadsheetLinkField control={control} name={name} disabled={disabled} />,
    },
    { name: 'sheet_title', label: 'Tên tab', type: 'text', required: true, section: SECTION_SOURCE, placeholder: 'Đúng tên tab ở dưới đáy bảng' },
    { name: 'header_row', label: 'Dòng tiêu đề', type: 'number', section: SECTION_SOURCE, defaultValue: 1, hint: 'Dòng chứa tên các cột (thường là dòng 1).' },
    { name: 'daily_report', label: 'Báo hằng ngày', type: 'switch', section: SECTION_SOURCE, defaultValue: false, hint: 'Bật nếu nhân viên phải báo số mỗi ngày: sau 18:00 bot tính ai chưa báo.' },
    { name: 'is_active', label: 'Đang đọc', type: 'switch', section: SECTION_SOURCE, defaultValue: true },
    {
      name: 'mapping', label: 'Ánh xạ cột', type: 'custom', section: SECTION_MAPPING, defaultValue: createEmptyMapping(),
      render: ({ control, name, disabled }) => (
        <div className="space-y-4">
          <MetricMappingField control={control} name={name} disabled={disabled} />
          <MetricSourcePreviewPanel control={control} />
        </div>
      ),
    },
  ],
  chips: (source) => [
    { icon: Database, text: source.sheet_title || 'Chưa có tab', tone: 'code' },
    { icon: source.is_active ? CircleCheck : CircleX, text: source.is_active ? 'Đang đọc' : 'Đã tắt', tone: source.is_active ? 'ok' : 'muted' },
    { icon: Calendar, text: source.daily_report ? 'Báo hằng ngày' : 'Không báo hằng ngày', tone: 'muted' },
    { icon: CircleCheck, text: getMetricSourceStatusLabel(source.status) || 'Chưa đọc', tone: 'muted' },
  ],
  detailActions: (source) => <MetricSourceActionButtons source={source} />,
  renderExtra: (source) => <MetricSourceStatusPanel source={source} />,
}
