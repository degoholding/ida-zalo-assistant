import { Calendar, Hash, Sparkles, UserRound } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDateTime } from '@/shared/utils/format-date'
import { briefApi, BRIEFS_API_PATH } from '../api/brief-api'
import { BriefBodyPanel } from '../components/brief-body-panel'
import { BriefStatusBadge } from '../components/brief-status-badge'
import {
  BRIEF_KIND_OPTIONS,
  BRIEF_STATUS_OPTIONS,
  BRIEF_TRIGGER_OPTIONS,
  getBriefKindLabel,
  getBriefTriggerLabel,
  type BriefDetail,
} from '../types/brief'

/** Cột Bản tin — `key` cột sắp xếp PHẢI trùng `sorts` của `BRIEF_LIST_SPEC` (`src/web/api/briefs-api.ts`). */
export const BRIEF_COLUMNS: DataTableColumn<BriefDetail>[] = [
  {
    key: 'sent_at',
    header: 'Lúc gửi',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (brief) => <span className="text-foreground">{formatDateTime(brief.sent_at) || '—'}</span>,
  },
  { key: 'recipient_name', header: 'Người nhận', width: 170, hideable: false, cell: (brief) => brief.recipient_name },
  { key: 'kind', header: 'Loại', width: 150, cell: (brief) => getBriefKindLabel(brief.kind) || '—' },
  { key: 'period_label', header: 'Kỳ', width: 220, wrap: true, cell: (brief) => brief.period_label },
  { key: 'trigger_source', header: 'Cách gửi', width: 130, cell: (brief) => getBriefTriggerLabel(brief.trigger_source) || '—' },
  {
    key: 'status',
    header: 'Trạng thái',
    width: 150,
    cell: (brief) => <BriefStatusBadge status={brief.status} kind={brief.kind} created_at={brief.created_at} />,
  },
  { key: 'has_ai', header: 'AI', width: 70, align: 'center', cell: (brief) => (brief.has_ai ? 'Có' : 'Không') },
  { key: 'file_count', header: 'Số tệp', width: 80, align: 'center', cell: (brief) => brief.file_count || '—' },
  {
    key: 'created_at',
    header: 'Lúc soạn',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    defaultHidden: true,
    cell: (brief) => <span className="text-muted-foreground">{formatDateTime(brief.created_at)}</span>,
  },
]

/** Lọc nhanh: loại / cách gửi / trạng thái — tập giá trị nhỏ, cố định. */
const BRIEF_QUICK_FILTERS = [
  { key: 'kind', label: 'Loại', type: 'select' as const, options: BRIEF_KIND_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })) },
  {
    key: 'trigger_source',
    label: 'Cách gửi',
    type: 'select' as const,
    options: BRIEF_TRIGGER_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
  },
  { key: 'status', label: 'Trạng thái', type: 'select' as const, options: BRIEF_STATUS_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })) },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `BRIEF_LIST_SPEC` ở máy chủ. */
const BRIEF_FILTER_FIELDS: FilterFieldDefinition[] = [
  {
    name: 'recipient_id',
    label: 'Người nhận',
    type: 'combobox',
    fetchOptions: async (search) => {
      const recipients = await briefApi.searchRecipients(search)
      return recipients.map((recipient) => ({ value: String(recipient.id), label: recipient.name }))
    },
  },
  { name: 'created_at', label: 'Lúc soạn', type: 'date' },
]

export const briefCrudConfig: CrudConfig<BriefDetail> = {
  entity: 'brief',
  title: 'Bản tin',
  description:
    'Bản tin sáng / cuối ngày và báo cáo tuần / tháng bot đã soạn / gửi cho từng người nhận. Chỉ xem lại nội dung và tải lại tệp — không sửa ở đây.',
  unitLabel: 'bản tin',
  apiPath: BRIEFS_API_PATH,
  emptyMessage: 'Chưa có bản tin nào — bản tin sáng / cuối ngày gửi theo giờ hẹn của người nhận (màn Người nhận).',
  storageKey: 'briefs.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm người nhận, kỳ',
  defaultSort: { by: 'created_at', dir: 'desc' },
  quickFilters: BRIEF_QUICK_FILTERS,
  columns: BRIEF_COLUMNS,
  filterConfig: { fields: BRIEF_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.briefs.list,
  detailRoute: (id) => appRoutes.briefs.detail(id),
  getItemName: (brief) => `${brief.recipient_name} · ${brief.period_label}`,
  // Bản tin do bot tự soạn / gửi, không có ô nào sửa tay — màn CHỈ XEM hoàn toàn (không cả nút thao tác)
  formFields: [],
  readOnlyDetail: true,
  chips: (brief) => [
    { icon: UserRound, text: brief.recipient_name, tone: 'muted' },
    { icon: Hash, text: getBriefKindLabel(brief.kind) || 'Không rõ', tone: 'code' },
    { icon: Calendar, text: brief.period_label, tone: 'muted' },
    { icon: Sparkles, text: brief.has_ai ? 'Có điểm tin AI' : 'Không có điểm tin AI', tone: brief.has_ai ? 'ok' : 'muted' },
  ],
  renderExtra: (brief) => <BriefBodyPanel brief={brief} />,
}
