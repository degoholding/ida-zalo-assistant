import { Hash, ListChecks, UserRound } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { getContactOptionLabel } from '@/shared/contact-card/format-contact'
import { filterLookupOptions } from '@/shared/lookups/use-lookups'
import { lookupApi } from '@/shared/lookups/lookup-api'
import { Pill } from '@/shared/ui/pill'
import { TASKS_API_PATH } from '../api/task-api'
import { TaskActionButtons } from '../components/task-action-buttons'
import { TaskCreateButton } from '../components/task-create-button'
import { TaskDetailPanel } from '../components/task-detail-panel'
import { TaskStatusBadge } from '../components/task-status-badge'
import { getTaskStatusLabel, TASK_STATUS, TASK_STATUS_OPTIONS, type TaskDetail } from '../types/task'
import { formatTaskDue } from '../utils/format-task-due'

/** Cột Việc — `key` cột sắp xếp PHẢI trùng `sorts` của `TASK_LIST_SPEC` (`src/web/api/tasks-api.ts`). */
export const TASK_COLUMNS: DataTableColumn<TaskDetail>[] = [
  {
    key: 'code',
    header: 'Mã',
    width: 90,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    sortDescFirst: true,
    cell: (task) => <span className="font-mono font-semibold text-navy">{task.code}</span>,
  },
  { key: 'title', header: 'Việc', width: 300, hideable: false, wrap: true, cell: (task) => task.title },
  {
    key: 'assignee_name',
    header: 'Người phụ trách',
    width: 160,
    cell: (task) => task.assignee_name || <span className="text-muted-foreground">Chưa có</span>,
  },
  {
    key: 'due_at',
    header: 'Hạn',
    width: 170,
    sortable: true,
    cell: (task) => (
      <span className={task.overdue ? 'flex items-center gap-1.5 font-medium text-destructive' : 'text-foreground'}>
        {formatTaskDue(task.due_at, task.due_has_time)}
        {task.overdue && <Pill tone="danger">Quá hạn</Pill>}
      </span>
    ),
  },
  { key: 'status', header: 'Trạng thái', width: 120, sortable: true, cell: (task) => <TaskStatusBadge status={task.status} /> },
  {
    key: 'source_thread_name',
    header: 'Nhóm',
    width: 160,
    cell: (task) => task.source_thread_name || <span className="text-muted-foreground">—</span>,
  },
  { key: 'assigner_name', header: 'Người giao', width: 150, cell: (task) => task.assigner_name || '—' },
  { key: 'priority', header: 'Ưu tiên', width: 100, defaultHidden: true, cell: (task) => task.priority },
]

const STATUS_FILTER_OPTIONS = TASK_STATUS_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))

/** Lọc nhanh: trạng thái (mặc định máy chủ chỉ hiện đề xuất + đang làm khi chưa chọn), quá hạn, thiếu người / thiếu hạn. */
const TASK_QUICK_FILTERS = [
  { key: 'status', label: 'Trạng thái', type: 'select' as const, options: STATUS_FILTER_OPTIONS },
  { key: 'overdue', label: 'Quá hạn', type: 'select' as const, options: [{ value: '1', label: 'Quá hạn' }] },
  { key: 'missing_assignee', label: 'Thiếu người phụ trách', type: 'select' as const, options: [{ value: '1', label: 'Thiếu người phụ trách' }] },
  { key: 'missing_due', label: 'Thiếu hạn', type: 'select' as const, options: [{ value: '1', label: 'Thiếu hạn' }] },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `TASK_LIST_SPEC` ở máy chủ. */
const TASK_FILTER_FIELDS: FilterFieldDefinition[] = [
  {
    name: 'assignee_contact_id',
    label: 'Người phụ trách',
    type: 'combobox',
    fetchOptions: async (search) => {
      const result = await lookupApi.searchContacts(search)
      return result.items.map((contact) => ({ value: String(contact.id), label: getContactOptionLabel(contact) }))
    },
  },
  { name: 'source_thread_id', label: 'Nhóm', type: 'combobox', fetchOptions: async (search) => filterLookupOptions(await lookupApi.threads(), search) },
  { name: 'due_at', label: 'Hạn', type: 'date' },
]

export const taskCrudConfig: CrudConfig<TaskDetail> = {
  entity: 'task',
  title: 'Việc',
  description:
    'Việc giao qua lệnh / câu tự nhiên với bot, recap họp, AI rà soát tin nhóm, hoặc tạo thẳng trên web. Thao tác ở đây làm bot báo người phụ trách / người giao qua Zalo như làm trên Zalo.',
  unitLabel: 'việc',
  apiPath: TASKS_API_PATH,
  emptyMessage: 'Chưa có việc nào — nhắn bot trên Zalo «giao … cho …» hoặc bấm «Thêm việc» ở đây.',
  storageKey: 'tasks.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm mã, tên việc, người phụ trách',
  defaultSort: { by: 'due_at', dir: 'asc' },
  quickFilters: TASK_QUICK_FILTERS,
  columns: TASK_COLUMNS,
  filterConfig: { fields: TASK_FILTER_FIELDS, allowConjunctionToggle: true },
  listRoute: appRoutes.tasks.list,
  detailRoute: (id) => appRoutes.tasks.detail(id),
  getItemName: (task) => `${task.code} ${task.title}`,
  // Việc do bot lập / lệnh Zalo, không có ô nào sửa tay trên web — tạo qua `TaskCreateButton`, đổi trạng thái qua `detailActions`
  formFields: [],
  readOnlyDetail: true,
  renderToolbarExtra: () => <TaskCreateButton />,
  chips: (task) => [
    { icon: Hash, text: task.code, tone: 'code' },
    { text: getTaskStatusLabel(task.status) || 'Không rõ', tone: task.status === TASK_STATUS.done ? 'ok' : 'muted' },
    { icon: UserRound, text: task.assignee_name || 'Chưa có người phụ trách', tone: 'muted' },
    { icon: ListChecks, text: `${formatTaskDue(task.due_at, task.due_has_time)}${task.overdue ? ' (quá hạn)' : ''}`, tone: 'muted' },
  ],
  detailActions: (task) => <TaskActionButtons task={task} />,
  renderExtra: (task) => <TaskDetailPanel task={task} />,
}
