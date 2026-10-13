import { Calendar, Hash, Send, UserRound } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDateTime } from '@/shared/utils/format-date'
import { SEND_COMMANDS_API_PATH } from '../api/send-command-api'
import { BotHaltToggleButton } from '../components/bot-halt-toggle-button'
import { SendCommandActionButtons } from '../components/send-command-action-buttons'
import { SendCommandBodyPanel } from '../components/send-command-body-panel'
import { SendCommandStatusBadge } from '../components/send-command-status-badge'
import {
  formatSendCommandCode,
  getSendActionKindLabel,
  getSendCommandSourceLabel,
  SEND_ACTION_KIND,
  SEND_ACTION_KIND_OPTIONS,
  SEND_COMMAND_SOURCE_OPTIONS,
  SEND_COMMAND_STATUS_OPTIONS,
  type SendCommandDetail,
} from '../types/send-command'

/** Cột «Gửi tin» — `key` cột sắp xếp PHẢI trùng `sorts` của `SEND_COMMAND_LIST_SPEC` (`src/web/api/send-commands-api.ts`). */
export const SEND_COMMAND_COLUMNS: DataTableColumn<SendCommandDetail>[] = [
  { key: 'id', header: 'Mã', width: 80, hideable: false, cell: (command) => <span className="font-mono">{formatSendCommandCode(command.id)}</span> },
  {
    key: 'created_at',
    header: 'Lúc tạo',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (command) => <span className="text-foreground">{formatDateTime(command.created_at)}</span>,
  },
  { key: 'action_kind', header: 'Loại', width: 100, sortable: true, cell: (command) => getSendActionKindLabel(command.action_kind) || '—' },
  { key: 'source', header: 'Nguồn', width: 110, cell: (command) => getSendCommandSourceLabel(command.source) || '—' },
  { key: 'requester_name', header: 'Người ra lệnh', width: 160, cell: (command) => command.requester_name || '—' },
  { key: 'target_count', header: 'Số nơi', width: 80, align: 'center', cell: (command) => command.target_count },
  {
    key: 'sent_count',
    header: 'Đã gửi / lỗi',
    width: 110,
    align: 'center',
    cell: (command) => (
      <span>
        {command.sent_count}
        {command.failed_count > 0 && <span className="text-destructive"> / {command.failed_count}</span>}
      </span>
    ),
  },
  {
    key: 'scheduled_at',
    header: 'Giờ hẹn',
    width: 150,
    sortable: true,
    cell: (command) => <span className="text-muted-foreground">{formatDateTime(command.scheduled_at) || '—'}</span>,
  },
  {
    key: 'reminder_at',
    header: 'Nhắc lúc',
    width: 150,
    sortable: true,
    cell: (command) => <span className="text-muted-foreground">{formatDateTime(command.reminder_at) || '—'}</span>,
  },
  { key: 'status', header: 'Trạng thái', width: 190, cell: (command) => <SendCommandStatusBadge command={command} /> },
  {
    key: 'body_preview',
    header: 'Nội dung',
    width: 320,
    wrap: true,
    cell: (command) => (
      <span className="text-muted-foreground">
        {command.body_preview}
        {command.body_truncated && '…'}
      </span>
    ),
  },
]

const SEND_COMMAND_QUICK_FILTERS = [
  { key: 'status', label: 'Trạng thái', type: 'select' as const, options: SEND_COMMAND_STATUS_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })) },
  { key: 'action_kind', label: 'Loại', type: 'select' as const, options: SEND_ACTION_KIND_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })) },
  { key: 'source', label: 'Nguồn', type: 'select' as const, options: SEND_COMMAND_SOURCE_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })) },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `SEND_COMMAND_LIST_SPEC` ở máy chủ. */
const SEND_COMMAND_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'created_at', label: 'Lúc tạo', type: 'date' },
  { name: 'scheduled_at', label: 'Giờ hẹn', type: 'date' },
  { name: 'reminder_at', label: 'Nhắc lúc', type: 'date' },
]

export const sendCommandCrudConfig: CrudConfig<SendCommandDetail> = {
  entity: 'send_command',
  title: 'Gửi tin',
  description:
    'Nhật ký lệnh gửi tin và nhắc hẹn nhóm (lệnh nhắn bot trên Zalo và tin quản trị gửi từ màn Hội thoại). Quản trị thấy hết; người khác chỉ thấy lệnh do chính mình ra. Hủy được lệnh đang hẹn; quản trị gửi lại nơi lỗi và tắt / bật bot khẩn.',
  unitLabel: 'lệnh gửi',
  apiPath: SEND_COMMANDS_API_PATH,
  emptyMessage: 'Chưa có lệnh gửi nào — nhắn bot trên Zalo «gửi nhóm …: …» để ra lệnh.',
  storageKey: 'send-commands.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm người ra lệnh, nội dung',
  defaultSort: { by: 'created_at', dir: 'desc' },
  quickFilters: SEND_COMMAND_QUICK_FILTERS,
  columns: SEND_COMMAND_COLUMNS,
  filterConfig: { fields: SEND_COMMAND_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.sendCommands.list,
  detailRoute: (id) => appRoutes.sendCommands.detail(id),
  getItemName: (command) => formatSendCommandCode(command.id),
  // Không có biểu mẫu soạn trên web: lệnh do bot nhận từ Zalo, web chỉ xem + hủy / gửi lại
  formFields: [],
  readOnlyDetail: true,
  renderToolbarExtra: () => <BotHaltToggleButton />,
  chips: (command) => [
    { icon: Hash, text: formatSendCommandCode(command.id), tone: 'code' },
    { icon: Send, text: getSendCommandSourceLabel(command.source) || 'Không rõ', tone: 'muted' },
    { icon: UserRound, text: command.requester_name || 'Không rõ người ra lệnh', tone: 'muted' },
    command.action_kind === SEND_ACTION_KIND.reminder
      ? { icon: Calendar, text: `Nhắc lúc ${formatDateTime(command.reminder_at) || '—'}`, tone: 'muted' }
      : { icon: Calendar, text: formatDateTime(command.scheduled_at) || (command.action_kind === SEND_ACTION_KIND.pin ? 'Ghim ngay' : 'Gửi ngay'), tone: 'muted' },
  ],
  detailActions: (command) => <SendCommandActionButtons command={command} />,
  renderExtra: (command) => <SendCommandBodyPanel command={command} />,
}
