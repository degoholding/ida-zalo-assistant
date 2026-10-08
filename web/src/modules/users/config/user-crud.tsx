import { CircleCheck, CircleX, LogIn, Mail, ShieldCheck, Users } from 'lucide-react'

import { getUserRoleLabel, USER_ROLE, USER_ROLE_OPTIONS } from '@/core/auth/user-role'
import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig, CrudRecord } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { ContactSelectField } from '@/shared/form-pickers/contact-select-field'
import { GroupMultiSelectField } from '@/shared/form-pickers/group-multi-select-field'
import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { formatDateTime } from '@/shared/utils/format-date'
import { USERS_API_PATH } from '../api/user-api'
import type { AppUserDetail } from '../types/user'
import { describeUserScope } from '../utils/describe-user-scope'

const ACTIVE_OPTIONS = [{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Ngừng' }]
const ROLE_FILTER_OPTIONS = USER_ROLE_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))

const ROLE_TONE: Record<number, StatusTone> = {
  [USER_ROLE.admin]: 'handoff',
  [USER_ROLE.manager]: 'progress',
  [USER_ROLE.staff]: 'neutral',
}

const SCOPE_SECTION = 'Phạm vi nhóm'

/** Ô chọn vai trò trả CHUỖI, bản ghi tải về là SỐ — so bằng `Number` để cả hai cùng đúng. */
const isAdminRole = (values: CrudRecord) => Number(values.role) === USER_ROLE.admin

const ROLE_HINT =
  'Quản trị = toàn quyền. Quản lý = xem + sửa nhóm, Danh bạ, tệp trong phạm vi, gửi tin dưới tên bot. Nhân viên = chỉ xem trong phạm vi.'

/** Cột Người dùng — `key` cột sắp xếp PHẢI trùng `sorts` của `USER_LIST_SPEC` (`src/web/api/users-api.ts`). */
export const USER_COLUMNS: DataTableColumn<AppUserDetail>[] = [
  {
    key: 'full_name',
    header: 'Họ tên',
    width: 220,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    cell: (user) => <span className="truncate font-semibold text-navy">{user.full_name || user.email}</span>,
  },
  { key: 'email', header: 'Email', width: 240, sortable: true, cell: (user) => <span className="truncate">{user.email}</span> },
  {
    key: 'role',
    header: 'Vai trò',
    width: 120,
    sortable: true,
    cell: (user) => <Pill tone={ROLE_TONE[user.role] ?? 'neutral'}>{getUserRoleLabel(user.role) || `Mã ${user.role}`}</Pill>,
  },
  { key: 'scope', header: 'Nhóm được xem', width: 160, cell: (user) => describeUserScope(user) },
  {
    key: 'contact_name',
    header: 'Người trên Zalo',
    width: 180,
    cell: (user) => user.contact_name ?? <span className="text-muted-foreground">Chưa gắn</span>,
  },
  {
    key: 'is_active',
    header: 'Trạng thái',
    width: 120,
    cell: (user) => (user.is_active ? <Pill tone="done">Đang dùng</Pill> : <Pill tone="neutral">Ngừng</Pill>),
  },
  {
    key: 'last_login_at',
    header: 'Đăng nhập gần nhất',
    width: 170,
    sortable: true,
    sortDescFirst: true,
    cell: (user) => <span className="text-muted-foreground">{formatDateTime(user.last_login_at) || 'Chưa đăng nhập'}</span>,
  },
  {
    key: 'created_at',
    header: 'Thêm lúc',
    width: 160,
    defaultHidden: true,
    cell: (user) => <span className="text-muted-foreground">{formatDateTime(user.created_at)}</span>,
  },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `USER_LIST_SPEC` ở máy chủ. */
const USER_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'full_name', label: 'Họ tên', type: 'text' },
  { name: 'role', label: 'Vai trò', type: 'select', options: ROLE_FILTER_OPTIONS },
  { name: 'is_active', label: 'Trạng thái', type: 'select', options: ACTIVE_OPTIONS },
  { name: 'last_login_at', label: 'Đăng nhập gần nhất', type: 'date' },
]

export const userCrudConfig: CrudConfig<AppUserDetail> = {
  entity: 'user',
  title: 'Người dùng',
  description:
    'Ai được vào khu quản trị này bằng nút «Đăng nhập bằng Google», với vai trò nào và thấy những nhóm nào. Đổi vai trò / phạm vi / tắt thì phiên đang mở của người đó phải đăng nhập lại.',
  unitLabel: 'người dùng',
  apiPath: USERS_API_PATH,
  emptyMessage: 'Chưa có người dùng nào — bấm «Thêm người dùng», nhập email Google của người đó.',
  storageKey: 'users.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm email, họ tên',
  defaultSort: { by: 'full_name', dir: 'asc' },
  quickFilters: [
    { key: 'role', label: 'Vai trò', type: 'select', options: ROLE_FILTER_OPTIONS },
    { key: 'is_active', label: 'Trạng thái', type: 'select', options: ACTIVE_OPTIONS },
  ],
  columns: USER_COLUMNS,
  filterConfig: { fields: USER_FILTER_FIELDS },
  listRoute: appRoutes.users.list,
  createRoute: appRoutes.users.create,
  detailRoute: (id) => appRoutes.users.detail(id),
  getItemName: (user) => user.full_name || user.email,
  formSections: {
    [SCOPE_SECTION]: 'Người này thấy những nhóm nào trên web (Hội thoại, Nhóm, Tệp, Danh bạ). Quản trị luôn thấy mọi nhóm.',
  },
  formFields: [
    {
      name: 'email',
      label: 'Email',
      type: 'text',
      required: true,
      placeholder: 'ten@congty.com',
      hint: 'Người này đăng nhập bằng nút Google với đúng email này',
    },
    { name: 'full_name', label: 'Họ tên', type: 'text', placeholder: 'Tên hiện trên thanh trên và trong nhật ký' },
    { name: 'role', label: 'Vai trò', type: 'select', required: true, options: USER_ROLE_OPTIONS, defaultValue: USER_ROLE.staff, hint: ROLE_HINT },
    {
      name: 'contact_id',
      label: 'Người trên Zalo',
      type: 'custom',
      defaultValue: 0,
      render: ({ control, name, disabled }) => (
        <ContactSelectField
          control={control}
          name={name}
          label="Người trên Zalo"
          disabled={disabled}
          hint="Không bắt buộc — gắn để bot biết tin nào trong nhóm là của người này."
        />
      ),
    },
    { name: 'is_active', label: 'Đang dùng', type: 'switch', hint: 'Tắt thì người này văng khỏi phiên đang mở và không đăng nhập được nữa.' },
    {
      name: 'all_groups',
      label: 'Thấy mọi nhóm',
      type: 'switch',
      section: SCOPE_SECTION,
      defaultValue: false,
      showWhen: (values) => !isAdminRole(values),
      hint: 'Bật thì không cần chọn từng nhóm — kể cả nhóm bot vào sau này.',
    },
    {
      name: 'group_ids',
      label: 'Nhóm được xem',
      type: 'custom',
      section: SCOPE_SECTION,
      showWhen: (values) => !isAdminRole(values) && !values.all_groups,
      render: ({ control, name, disabled }) => (
        <GroupMultiSelectField
          control={control}
          name={name}
          label="Nhóm được xem"
          disabled={disabled}
          hint="Chưa chọn nhóm nào thì người này đăng nhập được nhưng không thấy nhóm nào."
        />
      ),
    },
  ],
  chips: (user) => [
    { icon: Mail, text: user.email, tone: 'code' },
    { icon: ShieldCheck, text: getUserRoleLabel(user.role) || `Vai trò ${user.role}`, tone: 'ok' },
    { icon: Users, text: describeUserScope(user), tone: 'muted' },
    { icon: user.is_active ? CircleCheck : CircleX, text: user.is_active ? 'Đang dùng' : 'Ngừng', tone: user.is_active ? 'ok' : 'muted' },
    { icon: LogIn, text: user.last_login_at ? `Đăng nhập ${formatDateTime(user.last_login_at)}` : 'Chưa đăng nhập', tone: 'muted' },
  ],
}
