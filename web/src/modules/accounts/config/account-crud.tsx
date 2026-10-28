import { Activity, Database, FlaskConical, Hash, MessageSquare, Users } from 'lucide-react'

import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { formatDateTime } from '@/shared/utils/format-date'
import { ACCOUNTS_API_PATH } from '../api/account-api'
import { AccountCreateDialog } from '../components/account-create-dialog'
import { AccountEventsTab, AccountGroupsTab } from '../components/account-detail-tabs'
import { AccountFriendsTab } from '../components/account-friends-tab'
import { AccountKindBadge } from '../components/account-kind-badge'
import { AccountPurgeButton } from '../components/account-purge-button'
import { AccountRescanButton } from '../components/account-rescan-button'
import { AccountStateBadge } from '../components/account-state-badge'
import { BOT_ACCOUNT_KIND, BOT_ACCOUNT_KIND_OPTIONS, type BotAccountDetail } from '../types/account'

/** Cột Tài khoản bot — `key` cột sắp xếp PHẢI trùng `sorts` của `ACCOUNT_LIST_SPEC` (`src/web/api/accounts-api.ts`). */
export const ACCOUNT_COLUMNS: DataTableColumn<BotAccountDetail>[] = [
  {
    key: 'label',
    header: 'Tài khoản',
    width: 280,
    hideable: false,
    defaultPinned: true,
    sortable: true,
    cell: (account) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <EntityAvatar name={account.display_name || account.label} avatarUrl={account.avatar_url} />
        <div className="min-w-0">
          <div className="truncate font-semibold text-navy">{account.label}</div>
          <div className="truncate text-xs text-muted-foreground">{account.display_name || 'Chưa đăng nhập'}{account.zalo_uid ? ` · ${account.zalo_uid}` : ''}</div>
        </div>
      </div>
    ),
  },
  { key: 'kind', header: 'Loại', width: 190, cell: (account) => <AccountKindBadge account={account} /> },
  { key: 'state', header: 'Trạng thái', width: 220, cell: (account) => <AccountStateBadge account={account} /> },
  { key: 'group_count', header: 'Nhóm đang ở', width: 120, align: 'center', sortable: true, sortDescFirst: true, cell: (account) => account.group_count },
  { key: 'direct_count', header: 'Cuộc riêng', width: 110, align: 'center', cell: (account) => account.direct_count },
  {
    key: 'last_heartbeat_at',
    header: 'Nhịp tim gần nhất',
    width: 170,
    sortable: true,
    sortDescFirst: true,
    cell: (account) => <span className="text-muted-foreground">{formatDateTime(account.last_heartbeat_at) || '—'}</span>,
  },
  { key: 'created_at', header: 'Thêm lúc', width: 160, sortable: true, defaultHidden: true, cell: (account) => <span className="text-muted-foreground">{formatDateTime(account.created_at)}</span> },
]

export const accountCrudConfig: CrudConfig<BotAccountDetail> = {
  entity: 'bot_account',
  title: 'Tài khoản bot',
  description: 'Tài khoản Zalo mà bot dùng để đọc nhóm và trả lời tin riêng. Dùng tài khoản riêng cho bot, không dùng tài khoản chính của nhân sự.',
  unitLabel: 'tài khoản bot',
  apiPath: ACCOUNTS_API_PATH,
  storageKey: 'accounts.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm nhãn, tên Zalo',
  defaultSort: { by: 'label', dir: 'asc' },
  quickFilters: [
    { key: 'is_active', label: 'Đang dùng', type: 'select', options: [{ value: '1', label: 'Đang bật' }, { value: '0', label: 'Đã tắt' }] },
    { key: 'kind', label: 'Loại', type: 'select', options: BOT_ACCOUNT_KIND_OPTIONS },
  ],
  columns: ACCOUNT_COLUMNS,
  listRoute: appRoutes.accounts.list,
  detailRoute: (id) => appRoutes.accounts.detail(id),
  getItemName: (account) => account.label,
  FormDialog: AccountCreateDialog,
  formFields: [
    { name: 'label', label: 'Nhãn', type: 'text', readonlyOnEdit: true, hint: 'Tên gọi nội bộ của tài khoản, đặt lúc quét QR.' },
    {
      name: 'kind',
      label: 'Loại',
      type: 'select',
      options: BOT_ACCOUNT_KIND_OPTIONS,
      hint: 'Trợ lý: trả lời, báo, gửi tin như thường. Chỉ thu thập dữ liệu: chỉ lưu tin / thành viên / tệp, không bao giờ gửi hay tác động gì lên Zalo (trừ tab Kết bạn do quản trị tự bấm); nhóm chỉ có loại này thì không cảnh báo, bắt việc hay vào bản tin tự động. Tài khoản mới quét QR mặc định là Chỉ thu thập dữ liệu. Đổi có hiệu lực ngay.',
    },
    { name: 'is_active', label: 'Đang dùng', type: 'switch', hint: 'Tắt thì bot ngừng nghe ngay; bật lại thì nối lại bằng phiên đã lưu.' },
    { name: 'is_test', label: 'Tài khoản thử', type: 'switch', hint: 'Bật thì trang chi tiết có nút Xóa kèm dữ liệu (cuộc riêng + nhóm chỉ có tài khoản này). Tài khoản thật để tắt: chỉ Tắt được, không xóa.' },
  ],
  detailMedia: (account) => <EntityAvatar name={account.display_name || account.label} avatarUrl={account.avatar_url} className="size-14 text-base" />,
  chips: (account) => [
    ...(account.zalo_uid ? [{ icon: Hash, text: account.zalo_uid, tone: 'code' as const }] : []),
    { icon: Activity, text: account.state_label, tone: account.state === 'listening' ? 'ok' : 'muted' },
    ...(account.kind === BOT_ACCOUNT_KIND.normal ? [{ icon: Database, text: 'Chỉ thu thập dữ liệu', tone: 'muted' as const }] : []),
    ...(account.is_test ? [{ icon: FlaskConical, text: 'Tài khoản thử', tone: 'muted' as const }] : []),
    { icon: Users, text: `${account.group_count} nhóm`, tone: 'muted' },
    { icon: MessageSquare, text: `${account.direct_count} cuộc riêng`, tone: 'muted' },
  ],
  detailActions: (account) => (
    <>
      <AccountRescanButton label={account.label} />
      {account.is_test && <AccountPurgeButton accountId={account.id} label={account.label} />}
    </>
  ),
  tabs: [
    { key: 'groups', label: 'Nhóm đang ở', render: (account) => <AccountGroupsTab account={account} /> },
    { key: 'events', label: 'Nhật ký kết nối', render: (account) => <AccountEventsTab account={account} /> },
    // Nhân sự kết bạn với bot rồi kéo bot vào nhóm Zalo công việc
    { key: 'friends', label: 'Kết bạn', render: (account) => <AccountFriendsTab account={account} /> },
  ],
}
