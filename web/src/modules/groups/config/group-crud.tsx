import { Building2, Eye, EyeOff, FileText, Hash, MessageSquare, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { GroupKindBadge } from '@/shared/contact-card/contact-badges'
import { GROUP_KIND_OPTIONS } from '@/shared/contact-card/contact-constants'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { lookupApi, LOOKUP_URLS } from '@/shared/lookups/lookup-api'
import { filterLookupOptions } from '@/shared/lookups/use-lookups'
import { Button } from '@/shared/ui/button'
import { Pill } from '@/shared/ui/pill'
import { formatDateTime } from '@/shared/utils/format-date'
import { GROUPS_API_PATH } from '../api/group-api'
import { GroupBackfillButton } from '../components/group-backfill-button'
import { GroupBotsTab, GroupMembersTab } from '../components/group-detail-tabs'
import { OnOffPill } from '../components/on-off-pill'
import type { GroupDetail } from '../types/group'
import { getGroupName } from '../utils/format-group'

const RETENTION_MIN = 1
const RETENTION_MAX = 3650

/** Cột Nhóm — `key` cột sắp xếp PHẢI trùng `sorts` của `GROUP_LIST_SPEC` (`src/web/api/groups-api.ts`). */
export const GROUP_COLUMNS: DataTableColumn<GroupDetail>[] = [
  {
    key: 'name',
    header: 'Nhóm',
    width: 300,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    cell: (group) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <EntityAvatar name={getGroupName(group)} avatarUrl={group.avatar_url} shape="rounded" />
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{group.name || '(chưa rõ tên)'}</div>
          <div className="truncate text-xs text-muted-foreground">{group.label ? `Tên gọi: ${group.label}` : group.zalo_group_id}</div>
          {!group.bot_count && <Pill tone="danger">Không còn bot nào</Pill>}
        </div>
      </div>
    ),
  },
  {
    key: 'last_message_at',
    header: 'Tin đã lưu',
    width: 170,
    sortable: true,
    sortDescFirst: true,
    cell: (group) => (
      <div>
        <div>{group.message_count.toLocaleString('vi-VN')} tin</div>
        <div className="text-xs text-muted-foreground">{formatDateTime(group.last_message_at) || 'Chưa có tin'}</div>
      </div>
    ),
  },
  { key: 'member_count', header: 'Thành viên', width: 110, align: 'center', sortable: true, sortDescFirst: true, cell: (group) => group.member_count },
  { key: 'group_kind', header: 'Loại nhóm', width: 120, cell: (group) => <GroupKindBadge groupKind={group.group_kind} /> },
  { key: 'company', header: 'Công ty', width: 160, cell: (group) => group.company_name ?? <span className="text-muted-foreground">Chưa gán</span> },
  { key: 'read_messages', header: 'Đọc tin', width: 110, align: 'center', cell: (group) => <OnOffPill on={group.read_messages} onLabel="Đang đọc" offLabel="Tắt" /> },
  { key: 'capture_files', header: 'Lấy file', width: 110, align: 'center', cell: (group) => <OnOffPill on={group.capture_files} onLabel="Có lấy" offLabel="Không" /> },
  { key: 'file_count', header: 'Tệp', width: 80, align: 'center', defaultHidden: true, cell: (group) => group.file_count },
  { key: 'retention_days', header: 'Ngày lưu', width: 100, align: 'center', cell: (group) => group.retention_days },
  {
    key: 'first_seen_at',
    header: 'Thấy lần đầu',
    width: 160,
    defaultHidden: true,
    cell: (group) => <span className="text-muted-foreground">{formatDateTime(group.first_seen_at)}</span>,
  },
]

const toFilterOptions = (options: { value: number; label: string }[]) =>
  options.map((option) => ({ value: String(option.value), label: option.label }))

const ON_OFF_OPTIONS = [{ value: '1', label: 'Bật' }, { value: '0', label: 'Tắt' }]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `GROUP_LIST_SPEC`. */
const GROUP_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'group_kind', label: 'Loại nhóm', type: 'select', options: toFilterOptions(GROUP_KIND_OPTIONS) },
  { name: 'company_id', label: 'Công ty', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.companies(false), search) },
  { name: 'read_messages', label: 'Đọc tin', type: 'select', options: ON_OFF_OPTIONS },
  { name: 'capture_files', label: 'Lấy file', type: 'select', options: ON_OFF_OPTIONS },
  { name: 'has_bot', label: 'Còn bot trong nhóm', type: 'select', options: [{ value: '1', label: 'Còn' }, { value: '0', label: 'Không còn' }] },
  { name: 'label', label: 'Tên gọi', type: 'text' },
  { name: 'member_count', label: 'Số thành viên', type: 'number' },
  { name: 'retention_days', label: 'Số ngày lưu', type: 'number' },
  { name: 'last_message_at', label: 'Tin gần nhất', type: 'date' },
]

export const groupCrudConfig: CrudConfig<GroupDetail> = {
  entity: 'group',
  title: 'Nhóm',
  description: 'Nhóm Zalo mà tài khoản bot đang ở. Nhóm mới mặc định KHÔNG đọc, chưa gán công ty, loại «Khách hàng». Loại nhóm quyết định thành viên là khách hàng hay nhân sự trong Danh bạ.',
  unitLabel: 'nhóm',
  apiPath: GROUPS_API_PATH,
  emptyMessage: 'Chưa có nhóm nào — thêm tài khoản bot vào nhóm Zalo, nhóm sẽ hiện ở đây.',
  storageKey: 'groups.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên nhóm, tên gọi, mã nhóm',
  defaultSort: { by: 'last_message_at', dir: 'desc' },
  quickFilters: [
    { key: 'group_kind', label: 'Loại nhóm', type: 'select', options: GROUP_KIND_OPTIONS },
    { key: 'read_messages', label: 'Đọc tin', type: 'select', options: ON_OFF_OPTIONS },
    { key: 'company_id', label: 'Công ty', type: 'select', sourceUrl: LOOKUP_URLS.companies },
  ],
  columns: GROUP_COLUMNS,
  filterConfig: { fields: GROUP_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.groups.list,
  detailRoute: (id) => appRoutes.groups.detail(id),
  getItemName: (group) => getGroupName(group),
  formSections: {
    'Đọc và lưu': 'Bật «Đọc tin» thì bot mới lưu tin của nhóm; «Lấy file» thì tải cả tệp / ảnh về kho.',
  },
  formFields: [
    { name: 'label', label: 'Tên gọi', type: 'text', placeholder: 'Tên ngắn dễ nhớ, vd Kinh tế 52', hint: 'Hiện thay tên Zalo của nhóm ở mọi màn. Tối đa 100 ký tự.' },
    {
      name: 'group_kind',
      label: 'Loại nhóm',
      type: 'select',
      options: GROUP_KIND_OPTIONS,
      hint: 'Nội bộ → thành viên là nhân sự; Khách hàng → thành viên là khách hàng (trừ người đã chỉnh tay).',
    },
    { name: 'company_id', label: 'Công ty', type: 'select', source: { url: LOOKUP_URLS.companiesWithNone } },
    { name: 'read_messages', label: 'Đọc tin', type: 'switch', section: 'Đọc và lưu' },
    { name: 'capture_files', label: 'Lấy file', type: 'switch', section: 'Đọc và lưu' },
    {
      name: 'retention_days',
      label: 'Số ngày lưu',
      type: 'number',
      section: 'Đọc và lưu',
      required: true,
      hint: `Tin cũ hơn số ngày này bị dọn (${RETENTION_MIN}–${RETENTION_MAX}).`,
    },
  ],
  detailMaxWidth: 'max-w-none',
  detailMedia: (group) => <EntityAvatar name={getGroupName(group)} avatarUrl={group.avatar_url} shape="rounded" className="size-14 text-base" />,
  chips: (group) => [
    { icon: Hash, text: group.zalo_group_id, tone: 'code' },
    { icon: Users, text: `${group.member_count} thành viên`, tone: 'muted' },
    { icon: group.read_messages ? Eye : EyeOff, text: group.read_messages ? 'Đang đọc tin' : 'Không đọc tin', tone: group.read_messages ? 'ok' : 'muted' },
    { icon: MessageSquare, text: `${group.message_count.toLocaleString('vi-VN')} tin đã lưu`, tone: 'muted' },
    { icon: FileText, text: `${group.file_count} tệp`, tone: 'muted' },
    ...(group.company_name ? [{ icon: Building2, text: group.company_name, tone: 'muted' as const }] : []),
  ],
  detailActions: (group) => (
    <>
      <GroupBackfillButton groupId={group.id} />
      <Button variant="outline" size="sm" asChild>
        <Link to={appRoutes.conversations.detail(group.id)}>
          <MessageSquare />
          Mở hội thoại
        </Link>
      </Button>
    </>
  ),
  tabs: [
    { key: 'members', label: 'Thành viên', render: (group) => <GroupMembersTab group={group} /> },
    { key: 'bots', label: 'Bot trong nhóm', render: (group) => <GroupBotsTab group={group} /> },
  ],
}
