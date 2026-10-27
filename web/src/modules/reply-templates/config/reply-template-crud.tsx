import { Hash, MessageSquareQuote, UserRound } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig, CrudFormField } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDateTime } from '@/shared/utils/format-date'
import { REPLY_TEMPLATES_API_PATH } from '../api/reply-template-api'
import { ReplyTemplateActionButtons } from '../components/reply-template-action-buttons'
import { ReplyTemplateNotePanel } from '../components/reply-template-note-panel'
import { ReplyTemplateStatusBadge } from '../components/reply-template-status-badge'
import {
  getReplyToneLabel,
  REPLY_TEMPLATE_STATUS,
  REPLY_TEMPLATE_STATUS_OPTIONS,
  REPLY_TONE,
  REPLY_TONE_OPTIONS,
  type ReplyTemplate,
} from '../types/reply-template'

/** Cột "Mẫu tin" — `key` cột sắp xếp PHẢI trùng `sorts` của `REPLY_TEMPLATE_LIST_SPEC` (`src/web/api/reply-templates-api.ts`). */
export const REPLY_TEMPLATE_COLUMNS: DataTableColumn<ReplyTemplate>[] = [
  { key: 'name', header: 'Tên mẫu', width: 220, sortable: true, hideable: false, cell: (template) => <span className="font-medium">{template.name}</span> },
  { key: 'situation', header: 'Tình huống', width: 280, wrap: true, cell: (template) => <span className="text-muted-foreground">{template.situation || '—'}</span> },
  { key: 'tone', header: 'Tông', width: 110, sortable: true, cell: (template) => getReplyToneLabel(template.tone) || '—' },
  { key: 'status', header: 'Trạng thái', width: 120, sortable: true, cell: (template) => <ReplyTemplateStatusBadge status={template.status} /> },
  { key: 'author_name', header: 'Người soạn', width: 150, cell: (template) => template.author_name || '—' },
  { key: 'reviewer_name', header: 'Người duyệt', width: 150, cell: (template) => template.reviewer_name || '—' },
  {
    key: 'updated_at',
    header: 'Cập nhật',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (template) => <span className="text-muted-foreground">{formatDateTime(template.updated_at)}</span>,
  },
]

const toOptions = (options: { value: number; label: string }[]) => options.map((option) => ({ value: String(option.value), label: option.label }))

// "Chờ duyệt" đứng đầu để người duyệt bấm lọc nhanh việc của mình
const STATUS_FILTER_OPTIONS = [
  ...REPLY_TEMPLATE_STATUS_OPTIONS.filter((option) => option.value === REPLY_TEMPLATE_STATUS.pendingReview),
  ...REPLY_TEMPLATE_STATUS_OPTIONS.filter((option) => option.value !== REPLY_TEMPLATE_STATUS.pendingReview),
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `REPLY_TEMPLATE_LIST_SPEC` ở máy chủ. */
const REPLY_TEMPLATE_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'status', label: 'Trạng thái', type: 'select', options: toOptions(REPLY_TEMPLATE_STATUS_OPTIONS) },
  { name: 'tone', label: 'Tông', type: 'select', options: toOptions(REPLY_TONE_OPTIONS) },
  { name: 'updated_at', label: 'Cập nhật', type: 'date' },
]

const REPLY_TEMPLATE_FORM_FIELDS: CrudFormField[] = [
  { name: 'name', label: 'Tên mẫu', required: true, fullWidth: true, placeholder: 'Vd: Báo giá sản phẩm' },
  { name: 'situation', label: 'Tình huống dùng', fullWidth: true, hint: 'Khách hỏi / phản ánh gì thì dùng mẫu này — bot dựa vào đây để chọn mẫu.' },
  { name: 'keywords', label: 'Từ khóa', fullWidth: true, placeholder: 'giá, báo giá, bảng giá', hint: 'Gõ cách nhau bằng dấu phẩy.' },
  { name: 'tone', label: 'Tông', type: 'select', required: true, options: REPLY_TONE_OPTIONS, defaultValue: REPLY_TONE.formal },
  {
    name: 'body',
    label: 'Nội dung',
    type: 'textarea',
    required: true,
    fullWidth: true,
    hint: 'Dùng [tên khách], [giá], [ngày giao] cho chỗ cần điền. Lưu = gửi duyệt lại: mẫu đã duyệt mà sửa sẽ về "Chờ duyệt" và bot tạm ngừng dùng cho tới khi duyệt lại.',
  },
]

export const replyTemplateCrudConfig: CrudConfig<ReplyTemplate> = {
  entity: 'reply_template',
  title: 'Mẫu tin',
  description:
    'Thư viện mẫu trả lời khách. Ai cũng soạn / sửa được; bấm Lưu là gửi duyệt. Quản trị và Quản lý duyệt, trả lại (kèm ghi chú) hoặc ngừng dùng. Bot chỉ dùng mẫu "Đã duyệt".',
  unitLabel: 'mẫu tin',
  apiPath: REPLY_TEMPLATES_API_PATH,
  emptyMessage: 'Chưa có mẫu tin nào — bấm "Thêm mẫu tin" để soạn.',
  storageKey: 'reply-templates.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên, tình huống, từ khóa, nội dung',
  defaultSort: { by: 'updated_at', dir: 'desc' },
  quickFilters: [
    { key: 'status', label: 'Trạng thái', type: 'select', options: toOptions(STATUS_FILTER_OPTIONS) },
    { key: 'tone', label: 'Tông', type: 'select', options: toOptions(REPLY_TONE_OPTIONS) },
  ],
  columns: REPLY_TEMPLATE_COLUMNS,
  filterConfig: { fields: REPLY_TEMPLATE_FILTER_FIELDS, allowConjunctionToggle: true },
  formFields: REPLY_TEMPLATE_FORM_FIELDS,
  listRoute: appRoutes.replyTemplates.list,
  detailRoute: (id) => appRoutes.replyTemplates.detail(id),
  getItemName: (template) => template.name,
  chips: (template) => [
    { icon: Hash, text: `M-${template.id}`, tone: 'code' },
    { icon: MessageSquareQuote, text: getReplyToneLabel(template.tone) || 'Không rõ tông', tone: 'muted' },
    { icon: UserRound, text: template.author_name ? `Soạn: ${template.author_name}` : 'Chưa rõ người soạn', tone: 'muted' },
  ],
  //  Nhân viên chỉ sửa mẫu CỦA MÌNH (người duyệt sửa được mọi mẫu) — máy chủ trả cờ `can_edit`; mẫu người khác thì khóa ô, ẩn "Lưu"
  canEditRow: (template) => template.can_edit,
  detailActions: (template) => <ReplyTemplateActionButtons template={template} />,
  renderExtra: (template) => (
    <div className="space-y-3">
      <ReplyTemplateStatusBadge status={template.status} />
      <ReplyTemplateNotePanel template={template} />
    </div>
  ),
}
