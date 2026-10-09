import { Link } from 'react-router-dom'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { lookupApi, LOOKUP_URLS } from '@/shared/lookups/lookup-api'
import { filterLookupOptions } from '@/shared/lookups/use-lookups'
import { formatDateTime } from '@/shared/utils/format-date'
import { MESSAGE_SEARCH_API_PATH } from '../api/message-search-api'
import { MessageSearchNotice } from '../components/message-search-notice'
import { MessageSnippetCell } from '../components/message-snippet-cell'
import type { MessageSearchRecord } from '../types/message-search'

/** Cột kết quả — `key` cột sắp xếp PHẢI trùng `sorts` của `MESSAGE_SEARCH_SPEC` (`src/web/api/message-search-api.ts`). */
export const MESSAGE_SEARCH_COLUMNS: DataTableColumn<MessageSearchRecord>[] = [
  {
    key: 'sent_at',
    header: 'Lúc gửi',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (message) => <span className="text-muted-foreground">{formatDateTime(message.sent_at)}</span>,
  },
  {
    key: 'thread',
    header: 'Ở đâu',
    width: 200,
    cell: (message) => (
      <Link to={appRoutes.conversations.detail(message.thread_id)} className="block truncate hover:underline" onClick={(event) => event.stopPropagation()}>
        {message.thread_name}
      </Link>
    ),
  },
  { key: 'sender', header: 'Người gửi', width: 170, cell: (message) => <span className="block truncate">{message.sender_name || message.sender_uid}</span> },
  { key: 'snippet', header: 'Nội dung', width: 560, hideable: false, cell: (message) => <MessageSnippetCell message={message} /> },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `MESSAGE_SEARCH_SPEC`. */
const MESSAGE_SEARCH_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'group_id', label: 'Cuộc trò chuyện', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.threads(), search) },
  { name: 'sender_name', label: 'Người gửi', type: 'text' },
  { name: 'sent_at', label: 'Lúc gửi', type: 'date' },
]

export const messageSearchCrudConfig: CrudConfig<MessageSearchRecord> = {
  entity: 'conversation',
  title: 'Tìm tin',
  description:
    'Tìm tin nhắn cũ theo từ khóa trong các cuộc trò chuyện bạn được xem — gõ không dấu cũng tìm được, cụm cố định đặt trong ngoặc kép ("hợp đồng thép"). ' +
    'Lọc thêm theo cuộc trò chuyện, người gửi, khoảng ngày. Từ khóa quá phổ biến thì chỉ tìm trong 90 ngày gần nhất — chọn «Lúc gửi» ở bộ lọc để tìm xa hơn. ' +
    'Bấm «Xem trong hội thoại» để mở đúng tin cùng các tin trước và sau.',
  unitLabel: 'tin',
  apiPath: MESSAGE_SEARCH_API_PATH,
  emptyMessage: 'Gõ từ khóa vào ô tìm để bắt đầu (vd: công nợ Minh Phát).',
  storageKey: 'message-search.list',
  searchParam: 'q',
  searchPlaceholder: 'Từ khóa, vd: công nợ Minh Phát',
  defaultSort: { by: 'sent_at', dir: 'desc' },
  quickFilters: [{ key: 'group_id', label: 'Cuộc trò chuyện', type: 'select', sourceUrl: LOOKUP_URLS.threads }],
  columns: MESSAGE_SEARCH_COLUMNS,
  // Máy chủ tự giới hạn (chỉ dò từ ngày …, hơn 1.000 tin) thì báo ngay trên bảng
  listNotice: (result) => <MessageSearchNotice result={result} />,
  filterConfig: { fields: MESSAGE_SEARCH_FILTER_FIELDS, allowConjunctionToggle: false },
  listRoute: appRoutes.search.messages,
  // Kết quả tìm chỉ để xem — mọi việc làm tiếp ở màn Hội thoại
  formFields: [],
  getItemName: (message) => message.snippet.slice(0, 40),
}
