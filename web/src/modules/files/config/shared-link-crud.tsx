import { Link } from 'react-router-dom'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { lookupApi, LOOKUP_URLS } from '@/shared/lookups/lookup-api'
import { filterLookupOptions } from '@/shared/lookups/use-lookups'
import { Pill } from '@/shared/ui/pill'
import { formatDateTime } from '@/shared/utils/format-date'
import { SHARED_LINKS_API_PATH } from '../api/file-api'
import { SharedLinkCell } from '../components/shared-link-cell'
import { getSharedLinkKindLabel, SHARED_LINK_KIND, SHARED_LINK_KIND_OPTIONS, type SharedLinkRecord } from '../types/shared-link'

/** Cột Link chia sẻ — `key` cột sắp xếp PHẢI trùng `sorts` của `SHARED_LINK_LIST_SPEC` (`src/web/api/shared-links-api.ts`). */
export const SHARED_LINK_COLUMNS: DataTableColumn<SharedLinkRecord>[] = [
  { key: 'url', header: 'Link', width: 380, hideable: false, defaultPinned: true, cell: (link) => <SharedLinkCell link={link} /> },
  {
    key: 'kind',
    header: 'Loại',
    width: 170,
    sortable: true,
    cell: (link) => <Pill tone={link.kind === SHARED_LINK_KIND.web ? 'neutral' : 'progress'}>{getSharedLinkKindLabel(link.kind)}</Pill>,
  },
  { key: 'host', header: 'Tên miền', width: 170, sortable: true, cell: (link) => <span className="block truncate text-muted-foreground">{link.host}</span> },
  {
    key: 'sent_at',
    header: 'Lúc gửi',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (link) => (
      // Bấm giờ: mở đúng tin trong hội thoại
      <Link to={appRoutes.conversations.message(link.thread_id, link.message_id)} className="text-muted-foreground hover:underline" onClick={(event) => event.stopPropagation()}>
        {formatDateTime(link.sent_at)}
      </Link>
    ),
  },
  {
    key: 'thread',
    header: 'Ở đâu',
    width: 200,
    cell: (link) => (
      <Link to={appRoutes.conversations.detail(link.thread_id)} className="block truncate hover:underline" onClick={(event) => event.stopPropagation()}>
        {link.thread_name}
      </Link>
    ),
  },
  {
    key: 'sender',
    header: 'Người gửi',
    width: 200,
    cell: (link) => (
      <div className="flex min-w-0 items-center gap-2">
        <EntityAvatar name={link.sender_name || '?'} avatarUrl={link.sender_avatar_url} cardUid={link.sender_contact_id ? link.sender_uid : null} className="size-7" />
        <span className="truncate">{link.sender_name || link.sender_uid}</span>
      </div>
    ),
  },
]

const kindFilterOptions = SHARED_LINK_KIND_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `SHARED_LINK_LIST_SPEC`. */
const SHARED_LINK_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'kind', label: 'Loại', type: 'select', options: kindFilterOptions },
  { name: 'group_id', label: 'Cuộc trò chuyện', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.threads(), search) },
  { name: 'host', label: 'Tên miền', type: 'text' },
  { name: 'sender_name', label: 'Người gửi', type: 'text' },
  { name: 'sent_at', label: 'Lúc gửi', type: 'date' },
]

export const sharedLinkCrudConfig: CrudConfig<SharedLinkRecord> = {
  entity: 'file',
  title: 'Tệp',
  description: 'Link gửi trong các nhóm đang đọc và tin riêng: Google Sheets / Docs / Slides / Drive và web khác. Bấm link để mở ở tab mới; bấm giờ gửi để xem đúng tin trong hội thoại.',
  unitLabel: 'link',
  apiPath: SHARED_LINKS_API_PATH,
  emptyMessage: 'Chưa có link nào — link gửi trong nhóm đang đọc sẽ hiện ở đây.',
  storageKey: 'files.links',
  searchParam: 'q',
  searchPlaceholder: 'Tìm trong link, tiêu đề, người gửi',
  defaultSort: { by: 'sent_at', dir: 'desc' },
  quickFilters: [
    { key: 'kind', label: 'Loại', type: 'select', options: SHARED_LINK_KIND_OPTIONS },
    { key: 'group_id', label: 'Cuộc trò chuyện', type: 'select', sourceUrl: LOOKUP_URLS.threads },
  ],
  columns: SHARED_LINK_COLUMNS,
  // Bấm "Áp dụng" bộ lọc nâng cao viết lại query string — giữ `tab` để không văng về tab Tệp
  filterConfig: { fields: SHARED_LINK_FILTER_FIELDS, allowConjunctionToggle: true, preserveParams: ['tab'] },
  listRoute: appRoutes.files.list,
  // Link do tin Zalo sinh ra, chỉ xem — không thêm / sửa
  formFields: [],
  getItemName: (link) => link.title || link.url,
}
