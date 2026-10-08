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
import { formatFileSize } from '@/shared/utils/format-file-size'
import { FILES_API_PATH } from '../api/file-api'
import { FileNameCell } from '../components/file-name-cell'
import { FileRowActions } from '../components/file-row-actions'
import { FileStatusBadge } from '../components/file-status-badge'
import { FILE_STATUS_OPTIONS, type FileRecord } from '../types/file'
import { getFileName } from '../utils/get-file-name'

/** Cột Tệp — `key` cột sắp xếp PHẢI trùng `sorts` của `FILE_LIST_SPEC` (`src/web/api/files-api.ts`). */
export const FILE_COLUMNS: DataTableColumn<FileRecord>[] = [
  {
    key: 'file_name',
    header: 'Tệp',
    width: 320,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    // Bấm tên: ảnh hiện ngay trong hộp thoại, tệp khác hiện thông tin — kèm «Tải về» và «Xem trong hội thoại»
    cell: (file) => <FileNameCell file={file} />,
  },
  {
    key: 'sent_at',
    header: 'Lúc gửi',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (file) => <span className="text-muted-foreground">{formatDateTime(file.sent_at)}</span>,
  },
  {
    key: 'thread',
    header: 'Ở đâu',
    width: 200,
    cell: (file) => (
      <Link to={appRoutes.conversations.detail(file.thread_id)} className="block truncate hover:underline" onClick={(event) => event.stopPropagation()}>
        {file.thread_name}
      </Link>
    ),
  },
  {
    key: 'sender',
    header: 'Người gửi',
    width: 200,
    cell: (file) => (
      <div className="flex min-w-0 items-center gap-2">
        <EntityAvatar name={file.sender_name || '?'} avatarUrl={file.sender_avatar_url} cardUid={file.sender_contact_id ? file.sender_uid : null} className="size-7" />
        <span className="truncate">{file.sender_name || file.sender_uid}</span>
      </div>
    ),
  },
  { key: 'size', header: 'Cỡ', width: 100, align: 'right', sortable: true, sortDescFirst: true, cell: (file) => (file.size ? formatFileSize(file.size) : '—') },
  { key: 'status', header: 'Trạng thái', width: 200, sortable: true, cell: (file) => <FileStatusBadge status={file.status} lastError={file.last_error} keepFile={file.keep_file} /> },
  {
    key: 'text_chars',
    header: 'Nội dung',
    width: 120,
    cell: (file) =>
      file.text_chars === null ? <span className="text-xs text-muted-foreground">Chưa đọc</span> : <Pill tone="done">{file.text_chars.toLocaleString('vi-VN')} ký tự</Pill>,
  },
  { key: 'actions', header: '', width: 270, hideable: false, cell: (file) => <FileRowActions file={file} /> },
]

const toFilterOptions = (options: { value: number; label: string }[]) =>
  options.map((option) => ({ value: String(option.value), label: option.label }))

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `FILE_LIST_SPEC`. */
const FILE_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'status', label: 'Trạng thái', type: 'select', options: toFilterOptions(FILE_STATUS_OPTIONS) },
  { name: 'has_text', label: 'Đã đọc nội dung', type: 'select', options: [{ value: '1', label: 'Đã đọc' }, { value: '0', label: 'Chưa đọc' }] },
  { name: 'group_id', label: 'Cuộc trò chuyện', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.threads(), search) },
  { name: 'sender_name', label: 'Người gửi', type: 'text' },
  { name: 'file_ext', label: 'Đuôi tệp', type: 'text' },
  { name: 'size', label: 'Cỡ (byte)', type: 'number' },
  { name: 'sent_at', label: 'Lúc gửi', type: 'date' },
]

export const fileCrudConfig: CrudConfig<FileRecord> = {
  entity: 'file',
  title: 'Tệp',
  description: 'Tệp, ảnh, video gửi trong các nhóm đang đọc và tin riêng. Bấm tên tệp để xem ảnh / thông tin tệp và mở đúng chỗ trong hội thoại. «Đọc» bóc chữ trong tệp (bot cũng dùng chữ này để tóm tắt và tìm); «Tải vào kho» thử lấy lại tệp lỗi; nút ghim «Giữ tệp gốc» để tệp không bị xóa khi hết hạn giữ tệp của nhóm.',
  unitLabel: 'tệp',
  apiPath: FILES_API_PATH,
  emptyMessage: 'Chưa có tệp nào — bật «Lấy file» cho nhóm, tệp gửi trong nhóm sẽ hiện ở đây.',
  storageKey: 'files.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên tệp, người gửi, chữ trong tệp đã đọc',
  defaultSort: { by: 'sent_at', dir: 'desc' },
  quickFilters: [
    { key: 'status', label: 'Trạng thái', type: 'select', options: FILE_STATUS_OPTIONS },
    { key: 'group_id', label: 'Cuộc trò chuyện', type: 'select', sourceUrl: LOOKUP_URLS.threads },
  ],
  columns: FILE_COLUMNS,
  filterConfig: { fields: FILE_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.files.list,
  // Tệp do Zalo sinh ra, không có trang chi tiết riêng — mọi việc (tải về, tải lại) nằm ngay trên dòng
  formFields: [],
  getItemName: (file) => getFileName(file),
}
