import { BellRing, Briefcase, CircleCheck, CircleX, Clock, Hash, Star, UserRound } from 'lucide-react'

import { PermissionGate } from '@/core/authorization/permission-gate'
import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { ContactMultiSelectField } from '@/shared/form-pickers/contact-multi-select-field'
import { ContactSelectField } from '@/shared/form-pickers/contact-select-field'
import { GroupMultiSelectField } from '@/shared/form-pickers/group-multi-select-field'
import { Pill } from '@/shared/ui/pill'
import { formatDateTime } from '@/shared/utils/format-date'
import { RECIPIENTS_API_PATH } from '../api/recipient-api'
import { RecipientBriefTestButton } from '../components/recipient-brief-test-button'
import { RecipientTestButton } from '../components/recipient-test-button'
import { RecipientUserField } from '../components/recipient-user-field'
import type { RecipientDetail } from '../types/recipient'
import { buildRecipientPayload } from '../utils/build-recipient-payload'
import { formatBriefSchedule } from '../utils/format-brief-schedule'

/** Trần người VIP — khớp `MAX_VIPS` của `src/web/api/recipients-api.ts` (IDA câu 5: 20–30 người). */
export const MAX_RECIPIENT_VIPS = 50

const ACTIVE_OPTIONS = [{ value: '1', label: 'Đang dùng' }, { value: '0', label: 'Ngừng' }]

const WATCH_SECTION = 'Theo dõi'
const BRIEF_SECTION = 'Bản tin và cảnh báo'

/** Cột Người nhận — `key` cột sắp xếp PHẢI trùng `sorts` của `RECIPIENT_LIST_SPEC` (`src/web/api/recipients-api.ts`). */
export const RECIPIENT_COLUMNS: DataTableColumn<RecipientDetail>[] = [
  {
    key: 'name',
    header: 'Người nhận',
    width: 240,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    cell: (recipient) => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-navy">{recipient.name}</div>
        {recipient.title && <div className="truncate text-xs text-muted-foreground">{recipient.title}</div>}
      </div>
    ),
  },
  { key: 'rank_order', header: 'Ưu tiên', width: 90, align: 'center', sortable: true, cell: (recipient) => recipient.rank_order },
  { key: 'contact_name', header: 'Người trên Zalo', width: 180, cell: (recipient) => recipient.contact_name ?? '—' },
  {
    key: 'user_email',
    header: 'Tài khoản web',
    width: 200,
    cell: (recipient) => recipient.user_email ?? <span className="text-muted-foreground">Không gắn</span>,
  },
  {
    key: 'scope',
    header: 'Nhóm theo dõi',
    width: 140,
    cell: (recipient) => (recipient.all_groups ? 'Mọi nhóm' : recipient.group_count ? `${recipient.group_count} nhóm` : 'Chưa có nhóm nào'),
  },
  { key: 'vip_count', header: 'Người VIP', width: 100, align: 'center', cell: (recipient) => recipient.vip_count },
  {
    key: 'brief',
    header: 'Bản tin',
    width: 190,
    cell: (recipient) => formatBriefSchedule(recipient.morning_brief_at, recipient.evening_brief_at),
  },
  {
    key: 'notify_urgent',
    header: 'Tin khẩn',
    width: 110,
    align: 'center',
    cell: (recipient) => (recipient.notify_urgent ? <Pill tone="done">Báo ngay</Pill> : <Pill tone="neutral">Không</Pill>),
  },
  {
    key: 'is_active',
    header: 'Trạng thái',
    width: 120,
    cell: (recipient) => (recipient.is_active ? <Pill tone="done">Đang dùng</Pill> : <Pill tone="neutral">Ngừng</Pill>),
  },
  {
    key: 'created_at',
    header: 'Thêm lúc',
    width: 160,
    defaultHidden: true,
    cell: (recipient) => <span className="text-muted-foreground">{formatDateTime(recipient.created_at)}</span>,
  },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `RECIPIENT_LIST_SPEC` ở máy chủ. */
const RECIPIENT_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'name', label: 'Tên', type: 'text' },
  { name: 'title', label: 'Chức danh', type: 'text' },
  { name: 'rank_order', label: 'Thứ tự ưu tiên', type: 'number' },
  { name: 'is_active', label: 'Trạng thái', type: 'select', options: ACTIVE_OPTIONS },
]

export const recipientCrudConfig: CrudConfig<RecipientDetail> = {
  entity: 'recipient',
  title: 'Người nhận',
  description:
    'Ai nhận cảnh báo tin khẩn, việc đến hạn và bản tin sáng / cuối ngày. Bot nhắn riêng cho từng người trên Zalo, theo thứ tự ưu tiên.',
  unitLabel: 'người nhận',
  apiPath: RECIPIENTS_API_PATH,
  emptyMessage: 'Chưa có người nhận nào — bấm «Thêm người nhận», chọn người trên Zalo sẽ nhận cảnh báo và bản tin.',
  storageKey: 'recipients.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên, chức danh',
  defaultSort: { by: 'rank_order', dir: 'asc' },
  quickFilters: [{ key: 'is_active', label: 'Trạng thái', type: 'select', options: ACTIVE_OPTIONS }],
  columns: RECIPIENT_COLUMNS,
  filterConfig: { fields: RECIPIENT_FILTER_FIELDS },
  listRoute: appRoutes.recipients.list,
  createRoute: appRoutes.recipients.create,
  detailRoute: (id) => appRoutes.recipients.detail(id),
  getItemName: (recipient) => recipient.name,
  buildPayload: (payload) => buildRecipientPayload(payload),
  formSections: {
    [WATCH_SECTION]: 'Tin của nhóm nào được tính vào cảnh báo / bản tin của người này, và ai là người VIP.',
    [BRIEF_SECTION]: 'Giờ Việt Nam, dạng HH:MM. Để trống ô giờ = không gửi bản tin buổi đó.',
  },
  formFields: [
    { name: 'name', label: 'Tên', type: 'text', required: true, placeholder: 'vd Anh Hùng' },
    { name: 'title', label: 'Chức danh', type: 'text', placeholder: 'vd Trưởng phòng DVKH, CEO', hint: 'Hiện trong bản tin.' },
    {
      name: 'rank_order',
      label: 'Thứ tự ưu tiên',
      type: 'number',
      required: true,
      defaultValue: 1,
      hint: 'Từ 1 đến 20 — số nhỏ được báo trước.',
    },
    {
      name: 'contact_id',
      label: 'Người trên Zalo',
      type: 'custom',
      defaultValue: 0,
      render: ({ control, name, disabled }) => (
        <ContactSelectField
          control={control}
          name={name}
          label="Người trên Zalo"
          disabled={disabled}
          required
          hint="Bot nhắn riêng cảnh báo và bản tin cho người này trên Zalo"
        />
      ),
    },
    {
      name: 'user_id',
      label: 'Tài khoản web',
      type: 'custom',
      defaultValue: 0,
      render: ({ control, name, disabled }) => <RecipientUserField control={control} name={name} disabled={disabled} />,
    },
    { name: 'is_active', label: 'Đang dùng', type: 'switch', hint: 'Tắt thì bot ngừng gửi mọi cảnh báo và bản tin cho người này.' },
    {
      name: 'all_groups',
      label: 'Theo dõi mọi nhóm',
      type: 'switch',
      section: WATCH_SECTION,
      defaultValue: false,
      hint: 'Mọi nhóm bot đang đọc tin, kể cả nhóm vào sau này.',
    },
    {
      name: 'group_ids',
      label: 'Nhóm theo dõi',
      type: 'custom',
      section: WATCH_SECTION,
      showWhen: (values) => !values.all_groups,
      render: ({ control, name, disabled }) => (
        <GroupMultiSelectField control={control} name={name} label="Nhóm theo dõi" disabled={disabled} />
      ),
    },
    {
      name: 'vips',
      label: 'Người VIP',
      type: 'custom',
      section: WATCH_SECTION,
      render: ({ control, name, disabled }) => (
        <ContactMultiSelectField
          control={control}
          name={name}
          label="Người VIP"
          disabled={disabled}
          max={MAX_RECIPIENT_VIPS}
          hint="Tin của những người này lên đầu danh sách và được báo ngay — IDA câu 5"
        />
      ),
    },
    {
      name: 'morning_brief_at',
      label: 'Giờ bản tin sáng',
      type: 'text',
      section: BRIEF_SECTION,
      defaultValue: '07:30',
      placeholder: 'HH:MM',
      hint: 'Để trống = không gửi bản tin sáng.',
    },
    {
      name: 'evening_brief_at',
      label: 'Giờ bản tin cuối ngày',
      type: 'text',
      section: BRIEF_SECTION,
      defaultValue: '17:30',
      placeholder: 'HH:MM',
      hint: 'Để trống = không gửi bản tin cuối ngày.',
    },
    {
      name: 'notify_urgent',
      label: 'Báo ngay tin khẩn',
      type: 'switch',
      section: BRIEF_SECTION,
      hint: 'Tin KHẨN / tin của người VIP báo ngay, kể cả giờ yên lặng.',
    },
  ],
  chips: (recipient) => [
    { icon: Hash, text: `Ưu tiên ${recipient.rank_order}`, tone: 'code' },
    ...(recipient.title ? [{ icon: Briefcase, text: recipient.title, tone: 'muted' as const }] : []),
    ...(recipient.contact_name ? [{ icon: UserRound, text: recipient.contact_name, tone: 'muted' as const }] : []),
    { icon: Star, text: `${recipient.vip_count} người VIP`, tone: 'muted' },
    { icon: Clock, text: formatBriefSchedule(recipient.morning_brief_at, recipient.evening_brief_at), tone: 'muted' },
    ...(recipient.notify_urgent ? [{ icon: BellRing, text: 'Báo ngay tin khẩn', tone: 'ok' as const }] : []),
    {
      icon: recipient.is_active ? CircleCheck : CircleX,
      text: recipient.is_active ? 'Đang dùng' : 'Ngừng',
      tone: recipient.is_active ? 'ok' : 'muted',
    },
  ],
  detailActions: (recipient) => (
    <PermissionGate entity="recipient" action="write">
      <RecipientTestButton recipientId={recipient.id} />
      <RecipientBriefTestButton recipientId={recipient.id} />
    </PermissionGate>
  ),
}
