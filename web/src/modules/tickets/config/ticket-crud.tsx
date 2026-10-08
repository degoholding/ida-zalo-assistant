import { Hash, MessagesSquare, UserRound } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDateTime } from '@/shared/utils/format-date'
import { TICKETS_API_PATH } from '../api/ticket-api'
import { TicketActionButtons } from '../components/ticket-action-buttons'
import { TicketDetailPanel } from '../components/ticket-detail-panel'
import { TicketStatusBadge } from '../components/ticket-status-badge'
import { getTicketStatusLabel, TICKET_STATUS, TICKET_STATUS_OPTIONS, type TicketDetail } from '../types/ticket'
import { formatTicketSource } from '../utils/format-ticket-source'

/** Cột Ticket — `key` cột sắp xếp PHẢI trùng `sorts` của `TICKET_LIST_SPEC` (`src/web/api/tickets-api.ts`). */
export const TICKET_COLUMNS: DataTableColumn<TicketDetail>[] = [
  {
    key: 'code',
    header: 'Mã',
    width: 100,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    sortDescFirst: true,
    cell: (ticket) => <span className="font-mono font-semibold text-navy">{ticket.code}</span>,
  },
  { key: 'status', header: 'Trạng thái', width: 120, sortable: true, cell: (ticket) => <TicketStatusBadge status={ticket.status} /> },
  { key: 'title', header: 'Tiêu đề', width: 320, hideable: false, wrap: true, cell: (ticket) => ticket.title },
  { key: 'requester_name', header: 'Người gửi', width: 170, cell: (ticket) => ticket.requester_name || ticket.requester_uid || '—' },
  { key: 'source', header: 'Báo từ', width: 180, cell: (ticket) => formatTicketSource(ticket) },
  {
    key: 'handler_name',
    header: 'Người xử lý',
    width: 160,
    cell: (ticket) => ticket.handler_name || <span className="text-muted-foreground">Chưa ai nhận</span>,
  },
  { key: 'attachment_count', header: 'Tệp kèm', width: 90, align: 'center', cell: (ticket) => ticket.attachment_count || '—' },
  {
    key: 'created_at',
    header: 'Tạo lúc',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    cell: (ticket) => <span className="text-muted-foreground">{formatDateTime(ticket.created_at)}</span>,
  },
  {
    key: 'updated_at',
    header: 'Cập nhật',
    width: 150,
    sortable: true,
    sortDescFirst: true,
    defaultHidden: true,
    cell: (ticket) => <span className="text-muted-foreground">{formatDateTime(ticket.updated_at)}</span>,
  },
]

const STATUS_FILTER_OPTIONS = TICKET_STATUS_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `TICKET_LIST_SPEC` ở máy chủ. */
const TICKET_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'status', label: 'Trạng thái', type: 'select', options: STATUS_FILTER_OPTIONS },
  { name: 'requester_name', label: 'Người gửi', type: 'text' },
  { name: 'handler_name', label: 'Người xử lý', type: 'text' },
  { name: 'created_at', label: 'Tạo lúc', type: 'date' },
]

export const ticketCrudConfig: CrudConfig<TicketDetail> = {
  entity: 'ticket',
  title: 'Ticket',
  description:
    'Sự cố / yêu cầu nhân sự báo cho bot qua Zalo. Bot báo người xử lý; nhận, báo xong, hủy hay nhắn người gửi ngay trên web thì bot cũng nhắn lại cho người gửi y như làm trên Zalo.',
  unitLabel: 'ticket',
  apiPath: TICKETS_API_PATH,
  emptyMessage: 'Chưa có ticket nào — nhân sự nhắn bot trên Zalo để báo sự cố, ticket sẽ hiện ở đây.',
  storageKey: 'tickets.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm mã, tiêu đề, người gửi, người xử lý',
  defaultSort: { by: 'created_at', dir: 'desc' },
  quickFilters: [{ key: 'status', label: 'Trạng thái', type: 'select', options: TICKET_STATUS_OPTIONS }],
  columns: TICKET_COLUMNS,
  filterConfig: { fields: TICKET_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.tickets.list,
  detailRoute: (id) => appRoutes.tickets.detail(id),
  getItemName: (ticket) => `${ticket.code} ${ticket.title}`,
  // Ticket do bot lập từ tin Zalo, không có ô nào sửa tay — đổi trạng thái đi bằng nút ở `detailActions`
  formFields: [],
  readOnlyDetail: true,
  chips: (ticket) => [
    { icon: Hash, text: ticket.code, tone: 'code' },
    { text: getTicketStatusLabel(ticket.status) || 'Không rõ', tone: ticket.status === TICKET_STATUS.done ? 'ok' : 'muted' },
    { icon: UserRound, text: ticket.requester_name || ticket.requester_uid || 'Không rõ người gửi', tone: 'muted' },
    { icon: MessagesSquare, text: formatTicketSource(ticket), tone: 'muted' },
  ],
  detailActions: (ticket) => <TicketActionButtons ticket={ticket} />,
  renderExtra: (ticket) => <TicketDetailPanel ticket={ticket} />,
}
