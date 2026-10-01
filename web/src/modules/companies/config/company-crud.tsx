import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { Pill } from '@/shared/ui/pill'
import { formatDateTime } from '@/shared/utils/format-date'
import { CompanyGroupsTab } from '../components/company-groups-tab'
import type { CompanyDetail } from '../types/company'

export const COMPANIES_API_PATH = '/api/companies'

const ACTIVE_OPTIONS = [{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Ngừng' }]

/** Cột Công ty — `key` cột sắp xếp PHẢI trùng `sorts` của `COMPANY_LIST_SPEC` (`src/web/api/companies-api.ts`). */
export const COMPANY_COLUMNS: DataTableColumn<CompanyDetail>[] = [
  { key: 'code', header: 'Mã', width: 140, hideable: false, defaultPinned: true, sortable: true, cell: (company) => <span className="font-mono font-semibold text-navy">{company.code}</span> },
  { key: 'name', header: 'Tên công ty', width: 320, sortable: true, cell: (company) => company.name },
  {
    key: 'is_active',
    header: 'Trạng thái',
    width: 120,
    cell: (company) => (company.is_active ? <Pill tone="done">Đang dùng</Pill> : <Pill tone="neutral">Ngừng</Pill>),
  },
  { key: 'group_count', header: 'Số nhóm', width: 100, align: 'center', sortable: true, sortDescFirst: true, cell: (company) => company.group_count },
  { key: 'contact_count', header: 'Người đã gán', width: 120, align: 'center', sortable: true, sortDescFirst: true, cell: (company) => company.contact_count },
  { key: 'created_at', header: 'Tạo lúc', width: 160, sortable: true, defaultHidden: true, cell: (company) => <span className="text-muted-foreground">{formatDateTime(company.created_at)}</span> },
]

const COMPANY_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'code', label: 'Mã', type: 'text' },
  { name: 'name', label: 'Tên công ty', type: 'text' },
  { name: 'is_active', label: 'Trạng thái', type: 'select', options: ACTIVE_OPTIONS },
  { name: 'created_at', label: 'Tạo lúc', type: 'date' },
]

export const companyCrudConfig: CrudConfig<CompanyDetail> = {
  entity: 'company',
  title: 'Công ty',
  description: 'Công ty / pháp nhân trong cùng bộ cài. Nhóm Zalo và người trong Danh bạ gắn vào công ty; sau này quản lý công ty nào chỉ thấy dữ liệu của công ty đó.',
  unitLabel: 'công ty',
  apiPath: COMPANIES_API_PATH,
  storageKey: 'companies.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm mã, tên công ty',
  defaultSort: { by: 'name', dir: 'asc' },
  quickFilters: [{ key: 'is_active', label: 'Trạng thái', type: 'select', options: ACTIVE_OPTIONS }],
  columns: COMPANY_COLUMNS,
  filterConfig: { fields: COMPANY_FILTER_FIELDS },
  listRoute: appRoutes.companies.list,
  detailRoute: (id) => appRoutes.companies.detail(id),
  getItemName: (company) => `${company.name} (${company.code})`,
  formFields: [
    {
      name: 'code',
      label: 'Mã',
      type: 'text',
      required: true,
      readonlyOnEdit: true,
      placeholder: 'vd CTY-HCM',
      hint: 'Chữ không dấu, số, gạch ngang, gạch dưới — tối đa 30 ký tự. Không đổi được sau khi tạo.',
    },
    { name: 'name', label: 'Tên công ty', type: 'text', required: true, placeholder: 'Tên đầy đủ' },
    { name: 'is_active', label: 'Đang dùng', type: 'switch', hint: 'Ngừng thì không chọn được cho nhóm / người mới; dữ liệu đã gán giữ nguyên.' },
  ],
  tabs: [{ key: 'groups', label: 'Nhóm', render: (company) => <CompanyGroupsTab company={company} /> }],
}
