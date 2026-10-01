import { Bot, Building2, Hash, MessageSquare, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { KindBadge, KindSourceHint, RoleBadge, TagBadges } from '@/shared/contact-card/contact-badges'
import { CONTACT_KIND_OPTIONS, CONTACT_ROLE_OPTIONS, KIND_MODE_AUTO } from '@/shared/contact-card/contact-constants'
import { CONTACTS_API_PATH } from '@/shared/contact-card/contact-card-api'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { getContactName, getKindLabel, getRoleLabel } from '@/shared/contact-card/format-contact'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { lookupApi, LOOKUP_URLS } from '@/shared/lookups/lookup-api'
import { filterLookupOptions } from '@/shared/lookups/use-lookups'
import { Button } from '@/shared/ui/button'
import { formatDateTime } from '@/shared/utils/format-date'
import { ContactFilesTab, ContactGroupsTab, ContactRecentTab, ContactTurnsTab } from '../components/contact-detail-tabs'
import { ContactTagsField } from '../components/contact-tags-field'
import type { ContactDetail } from '../types/contact'

/**
 * Cột Danh bạ. `key` của cột sắp xếp được PHẢI trùng khóa `sorts` của `CONTACT_LIST_SPEC` ở máy chủ
 * (`src/web/api/contacts-api.ts`) — lệch là bấm tiêu đề không đổi thứ tự gì cả.
 */
export const CONTACT_COLUMNS: DataTableColumn<ContactDetail>[] = [
  {
    key: 'name',
    header: 'Người',
    width: 280,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    cell: (contact) => {
      const name = getContactName(contact)
      return (
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityAvatar name={name} avatarUrl={contact.avatar_url} cardUid={contact.zalo_uid} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-navy">{name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {contact.zalo_name && contact.zalo_name !== name ? contact.zalo_name : contact.zalo_uid}
            </div>
          </div>
        </div>
      )
    },
  },
  {
    key: 'kind',
    header: 'Loại',
    width: 140,
    cell: (contact) => (
      <div className="flex flex-col items-start gap-0.5">
        <KindBadge kind={contact.kind} isBot={contact.is_bot} />
        {!contact.is_bot && <KindSourceHint kindSource={contact.kind_source} />}
      </div>
    ),
  },
  { key: 'role', header: 'Vai trò với bot', width: 190, cell: (contact) => <RoleBadge role={contact.role} /> },
  { key: 'company', header: 'Công ty', width: 150, cell: (contact) => contact.company_name ?? '—' },
  { key: 'tags', header: 'Thẻ', width: 200, wrap: true, cell: (contact) => <TagBadges tags={contact.tags} /> },
  {
    key: 'last_dm_at',
    header: 'Nhắn riêng bot',
    width: 170,
    sortable: true,
    sortDescFirst: true,
    cell: (contact) =>
      contact.dm_count ? (
        <div>
          <div>{contact.dm_count} tin</div>
          <div className="text-xs text-muted-foreground">{formatDateTime(contact.last_dm_at)}</div>
        </div>
      ) : (
        <span className="text-muted-foreground">Chưa nhắn</span>
      ),
  },
  { key: 'group_count', header: 'Số nhóm', width: 100, align: 'center', sortable: true, sortDescFirst: true, cell: (contact) => contact.group_count },
  { key: 'note', header: 'Ghi chú', width: 220, cell: (contact) => contact.note || '—' },
  {
    key: 'first_seen_at',
    header: 'Thấy lần đầu',
    width: 160,
    sortable: true,
    defaultHidden: true,
    cell: (contact) => <span className="text-muted-foreground">{formatDateTime(contact.first_seen_at)}</span>,
  },
]

const toFilterOptions = (options: { value: number; label: string }[]) =>
  options.map((option) => ({ value: String(option.value), label: option.label }))

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `CONTACT_LIST_SPEC` ở máy chủ. */
const CONTACT_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'kind', label: 'Loại', type: 'select', options: toFilterOptions(CONTACT_KIND_OPTIONS) },
  { name: 'role', label: 'Vai trò với bot', type: 'select', options: toFilterOptions(CONTACT_ROLE_OPTIONS) },
  { name: 'company_id', label: 'Công ty', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.companies(false), search) },
  { name: 'group_id', label: 'Ở nhóm', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.groups(), search) },
  {
    name: 'tag',
    label: 'Thẻ',
    type: 'combobox',
    fetchOptions: async (search) =>
      (await lookupApi.contactTags()).filter((tag) => tag.toLowerCase().includes(search.toLowerCase())).map((tag) => ({ value: tag, label: tag })),
  },
  { name: 'note', label: 'Ghi chú', type: 'text' },
  { name: 'dm_count', label: 'Số tin nhắn riêng', type: 'number' },
  { name: 'last_dm_at', label: 'Nhắn riêng gần nhất', type: 'date' },
  { name: 'first_seen_at', label: 'Thấy lần đầu', type: 'date' },
]

export const contactCrudConfig: CrudConfig<ContactDetail> = {
  entity: 'contact',
  title: 'Danh bạ',
  description: 'Mọi người bot từng thấy — nhắn riêng cho bot và thành viên các nhóm. Bấm ảnh để xem nhanh, bấm dòng để mở hồ sơ.',
  unitLabel: 'người',
  apiPath: CONTACTS_API_PATH,
  emptyMessage: 'Chưa có ai — bot vào nhóm hoặc nhận tin riêng là Danh bạ tự có người.',
  storageKey: 'contacts.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên, mã Zalo, ghi chú',
  defaultSort: { by: 'last_dm_at', dir: 'desc' },
  quickFilters: [
    { key: 'kind', label: 'Loại', type: 'select', options: CONTACT_KIND_OPTIONS },
    { key: 'role', label: 'Vai trò', type: 'select', options: CONTACT_ROLE_OPTIONS },
    { key: 'direct', label: 'Nhắn riêng', type: 'select', options: [{ value: '1', label: 'Đã nhắn riêng bot' }, { value: '0', label: 'Chưa nhắn riêng' }] },
  ],
  columns: CONTACT_COLUMNS,
  filterConfig: { fields: CONTACT_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.contacts.list,
  detailRoute: (id) => appRoutes.contacts.detail(id),
  getItemName: (contact) => getContactName(contact),
  // Danh bạ tự sinh từ Zalo — không tạo tay (quản trị không có quyền create); biểu mẫu chỉ để SỬA hồ sơ
  formFields: [
    {
      name: 'kind_mode',
      label: 'Loại',
      type: 'select',
      options: [{ value: KIND_MODE_AUTO, label: 'Theo nhóm (tự động)' }, ...CONTACT_KIND_OPTIONS],
      hint: 'Theo nhóm: nhóm nội bộ → nhân sự, còn lại → khách hàng. Chọn tay thì tự động không ghi đè nữa.',
    },
    { name: 'role', label: 'Vai trò với bot', type: 'select', options: CONTACT_ROLE_OPTIONS, hint: 'Có vai trò thì bot trả lời khi người này nhắn riêng.' },
    { name: 'company_id', label: 'Công ty', type: 'select', source: { url: LOOKUP_URLS.companiesWithNone } },
    { name: 'tags', label: 'Thẻ', type: 'custom', render: (ctx) => <ContactTagsField control={ctx.control} name={ctx.name} disabled={ctx.disabled} /> },
    { name: 'note', label: 'Ghi chú', type: 'textarea', fullWidth: true, placeholder: 'Số điện thoại, nhu cầu, lưu ý khi chăm sóc…' },
  ],
  detailMaxWidth: 'max-w-none',
  detailMedia: (contact) => <EntityAvatar name={getContactName(contact)} avatarUrl={contact.avatar_url} className="size-14 text-base" />,
  chips: (contact) => [
    { icon: Hash, text: contact.zalo_uid, tone: 'code' },
    { icon: contact.is_bot ? Bot : Users, text: contact.is_bot ? 'Tài khoản bot' : getKindLabel(contact.kind), tone: 'ok' },
    ...(contact.role ? [{ icon: Bot, text: `Hỏi được bot · ${getRoleLabel(contact.role)}`, tone: 'ok' as const }] : []),
    ...(contact.company_name ? [{ icon: Building2, text: contact.company_name, tone: 'muted' as const }] : []),
    { icon: MessageSquare, text: `${contact.message_total} tin · ${contact.dm_count} nhắn riêng`, tone: 'muted' },
  ],
  detailActions: (contact) =>
    contact.direct_thread_id ? (
      <Button variant="outline" size="sm" asChild>
        <Link to={appRoutes.conversations.detail(contact.direct_thread_id)}>
          <MessageSquare />
          Mở hội thoại
        </Link>
      </Button>
    ) : null,
  tabs: [
    { key: 'groups', label: 'Nhóm', render: (contact) => <ContactGroupsTab contact={contact} /> },
    { key: 'recent', label: 'Tin gần đây', render: (contact) => <ContactRecentTab contact={contact} /> },
    { key: 'files', label: 'Tệp đã gửi', render: (contact) => <ContactFilesTab contact={contact} /> },
    { key: 'turns', label: 'Hỏi bot', render: (contact) => <ContactTurnsTab contact={contact} /> },
  ],
}
