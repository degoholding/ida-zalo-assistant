import { Hash, MapPin, Phone, UserRound } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { Pill } from '@/shared/ui/pill'
import { CATALOG_API_PATH } from '../api/catalog-api'
import { CatalogCandidatePanel } from '../components/catalog-candidate-panel'
import { CatalogMatchStatusBadge } from '../components/catalog-match-status-badge'
import { CatalogToolbar } from '../components/catalog-toolbar'
import {
  CATALOG_KIND_OPTIONS,
  CATALOG_MATCH_STATUS_OPTIONS,
  getCatalogKindLabel,
  type CatalogEntry,
  type CatalogEntryDetail,
} from '../types/catalog'

/** Cột «Danh mục NV / ĐL» — `key` cột sắp xếp PHẢI trùng `sorts` của `CATALOG_LIST_SPEC` (`src/web/api/catalog-api.ts`). */
export const CATALOG_COLUMNS: DataTableColumn<CatalogEntry>[] = [
  { key: 'kind', header: 'Loại', width: 110, sortable: true, cell: (entry) => <Pill>{getCatalogKindLabel(entry.kind) || '—'}</Pill> },
  { key: 'code', header: 'Mã', width: 110, sortable: true, hideable: false, cell: (entry) => <span className="font-mono">{entry.code}</span> },
  { key: 'name', header: 'Tên', width: 220, sortable: true, hideable: false, cell: (entry) => <span className="font-semibold text-navy">{entry.name}</span> },
  { key: 'phone', header: 'SĐT', width: 130, cell: (entry) => entry.phone || '—' },
  { key: 'region', header: 'Khu vực', width: 150, sortable: true, cell: (entry) => entry.region || '—' },
  { key: 'sales_zone', header: 'Vùng sales', width: 170, sortable: true, cell: (entry) => entry.sales_zone || '—' },
  { key: 'owner_name', header: 'Người phụ trách', width: 170, sortable: true, cell: (entry) => entry.owner_name || '—' },
  { key: 'contact_name', header: 'Liên hệ Zalo', width: 180, cell: (entry) => entry.contact_name || <span className="text-muted-foreground">Chưa gắn</span> },
  { key: 'match_status', header: 'Khớp Danh bạ', width: 170, sortable: true, cell: (entry) => <CatalogMatchStatusBadge status={entry.match_status} /> },
  { key: 'is_active', header: 'Đang hoạt động', width: 120, align: 'center', defaultHidden: true, cell: (entry) => (entry.is_active ? 'Có' : 'Không') },
]

const toFilterOptions = (options: { value: number; label: string }[]) =>
  options.map((option) => ({ value: String(option.value), label: option.label }))

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `CATALOG_LIST_SPEC` ở máy chủ. */
const CATALOG_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'kind', label: 'Loại', type: 'select', options: toFilterOptions(CATALOG_KIND_OPTIONS) },
  { name: 'region', label: 'Khu vực', type: 'text' },
  { name: 'sales_zone', label: 'Vùng sales', type: 'text' },
  { name: 'match_status', label: 'Khớp Danh bạ', type: 'select', options: toFilterOptions(CATALOG_MATCH_STATUS_OPTIONS) },
  {
    name: 'is_active',
    label: 'Đang hoạt động',
    type: 'select',
    options: [
      { value: '1', label: 'Có' },
      { value: '0', label: 'Không' },
    ],
  },
]

export const catalogCrudConfig: CrudConfig<CatalogEntryDetail> = {
  entity: 'catalog',
  title: 'Danh mục NV / ĐL',
  description:
    'Danh mục nhân viên và đại lý nạp từ Excel — nguồn của khu vực, vùng sales, người phụ trách hiện ở Danh bạ. Tải mẫu, điền, nạp lại bao nhiêu lần cũng được; chỗ khớp Danh bạ không chắc thì quản trị bấm chọn.',
  unitLabel: 'mục danh mục',
  apiPath: CATALOG_API_PATH,
  emptyMessage: 'Chưa có danh mục — bấm «Tải mẫu Excel», điền rồi «Nạp danh mục».',
  storageKey: 'catalog.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm mã, tên, SĐT',
  defaultSort: { by: 'code', dir: 'asc' },
  quickFilters: [
    { key: 'kind', label: 'Loại', type: 'select', options: CATALOG_KIND_OPTIONS },
    { key: 'match_status', label: 'Khớp Danh bạ', type: 'select', options: CATALOG_MATCH_STATUS_OPTIONS },
  ],
  columns: CATALOG_COLUMNS as DataTableColumn<CatalogEntryDetail>[],
  filterConfig: { fields: CATALOG_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.catalog.list,
  detailRoute: (id) => appRoutes.catalog.detail(id),
  getItemName: (entry) => `${entry.code} · ${entry.name}`,
  // Dữ liệu đến từ tệp Excel — không có biểu mẫu sửa tay; web chỉ xem + xác nhận / bỏ gắn liên hệ
  formFields: [],
  readOnlyDetail: true,
  renderToolbarExtra: () => <CatalogToolbar />,
  chips: (entry) => [
    { icon: Hash, text: entry.code, tone: 'code' },
    { icon: UserRound, text: getCatalogKindLabel(entry.kind) || 'Không rõ', tone: 'ok' },
    ...(entry.region ? [{ icon: MapPin, text: [entry.region, entry.sales_zone].filter(Boolean).join(' · '), tone: 'muted' as const }] : []),
    ...(entry.owner_name ? [{ icon: UserRound, text: `Phụ trách: ${entry.owner_name}`, tone: 'muted' as const }] : []),
    ...(entry.phone ? [{ icon: Phone, text: entry.phone, tone: 'muted' as const }] : []),
  ],
  renderExtra: (entry) => <CatalogCandidatePanel entry={entry} />,
}
