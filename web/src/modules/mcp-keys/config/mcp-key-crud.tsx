import { Hash, ShieldCheck } from 'lucide-react'

import type { FilterFieldDefinition } from '@/shared/conditional-filter'
import { appRoutes } from '@/shared/constants/app-routes'
import type { CrudConfig } from '@/shared/crud/types'
import type { DataTableColumn } from '@/shared/data-table'
import { Pill } from '@/shared/ui/pill'
import { formatDateTime } from '@/shared/utils/format-date'
import { MCP_KEYS_API_PATH } from '../api/mcp-key-api'
import { McpKeyCreateDialog } from '../components/mcp-key-create-dialog'
import { McpKeyDetailPanel } from '../components/mcp-key-detail-panel'
import { McpKeyRevokeButton } from '../components/mcp-key-revoke-button'
import { MCP_KEY_SCOPE_PARAM, McpKeyScopeToggle } from '../components/mcp-key-scope-toggle'
import { McpKeyStatusBadge } from '../components/mcp-key-status-badge'
import {
  getMcpAccessLevelLabel,
  MCP_ACCESS_LEVEL_OPTIONS,
  MCP_KEY_STATUS_OPTIONS,
  type McpKeyDetail,
} from '../types/mcp-key'

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>

/** Cột Khóa MCP — `key` cột sắp xếp PHẢI trùng `sorts` của `MCP_KEY_LIST_SPEC` (`src/web/api/mcp-keys-api.ts`). */
export const MCP_KEY_COLUMNS: DataTableColumn<McpKeyDetail>[] = [
  { key: 'name', header: 'Tên khóa', width: 220, hideable: false, defaultPinned: true, sortable: true, cell: (row) => <span className="font-semibold text-navy">{row.name}</span> },
  { key: 'prefix', header: 'Tiền tố', width: 110, cell: (row) => <span className="font-mono text-xs">{row.prefix}</span> },
  { key: 'access_level', header: 'Mức quyền', width: 110, cell: (row) => getMcpAccessLevelLabel(row.access_level) || '—' },
  {
    key: 'include_confidential',
    header: 'Mật',
    width: 80,
    align: 'center',
    cell: (row) => (row.include_confidential ? <Pill tone="handoff">Có</Pill> : muted('Không')),
  },
  { key: 'expires_at', header: 'Hết hạn', width: 150, cell: (row) => (row.expires_at ? formatDateTime(row.expires_at) : muted('Không hết hạn')) },
  {
    key: 'last_used_at',
    header: 'Dùng lần cuối',
    width: 210,
    sortable: true,
    cell: (row) =>
      row.last_used_at ? (
        <span>
          {formatDateTime(row.last_used_at)}
          {row.last_used_ip && <span className="text-muted-foreground"> · {row.last_used_ip}</span>}
        </span>
      ) : (
        muted('Chưa dùng')
      ),
  },
  { key: 'status', header: 'Trạng thái', width: 120, cell: (row) => <McpKeyStatusBadge status={row.status} /> },
  // Chủ khóa: với người thường luôn là chính mình, nên ẩn mặc định; quản trị bật «Tất cả người dùng» thì mở cột này ra
  { key: 'owner_name', header: 'Chủ khóa', width: 170, defaultHidden: true, cell: (row) => row.owner_name || '—' },
  { key: 'created_at', header: 'Tạo lúc', width: 150, sortable: true, defaultHidden: true, cell: (row) => muted(formatDateTime(row.created_at)) },
]

/** Bộ lọc nâng cao — tên trường PHẢI nằm trong `fields` của `MCP_KEY_LIST_SPEC` ở máy chủ. */
const MCP_KEY_FILTER_FIELDS: FilterFieldDefinition[] = [
  { name: 'name', label: 'Tên', type: 'text' },
  { name: 'access_level', label: 'Mức quyền', type: 'select', options: MCP_ACCESS_LEVEL_OPTIONS.map((o) => ({ value: String(o.value), label: o.label })) },
]

export const mcpKeyCrudConfig: CrudConfig<McpKeyDetail> = {
  entity: 'mcp_key',
  title: 'Khóa MCP',
  description:
    'Khóa để AI ngoài (Claude, Codex…) đọc dữ liệu bot qua cổng MCP, với đúng quyền tài khoản của anh/chị. Khóa chỉ hiện một lần lúc tạo.',
  unitLabel: 'khóa MCP',
  apiPath: MCP_KEYS_API_PATH,
  emptyMessage: 'Chưa có khóa nào — bấm «Thêm khóa MCP» để tạo khóa cho Claude / Codex.',
  storageKey: 'mcp-keys.list',
  searchParam: 'q',
  searchPlaceholder: 'Tìm tên, tiền tố',
  defaultSort: { by: 'created_at', dir: 'desc' },
  quickFilters: [
    { key: 'status', label: 'Trạng thái', type: 'select', options: MCP_KEY_STATUS_OPTIONS },
    // Không vẽ ô chọn (loại `chip`); chỉ để khung chuyển `?scope=all` của công tắc quản trị lên máy chủ
    { key: MCP_KEY_SCOPE_PARAM, label: 'Phạm vi', type: 'chip' },
  ],
  columns: MCP_KEY_COLUMNS,
  filterConfig: { fields: MCP_KEY_FILTER_FIELDS },
  listRoute: appRoutes.mcpKeys.list,
  detailRoute: (id) => appRoutes.mcpKeys.detail(id),
  getItemName: (row) => row.name,
  // Tạo khóa qua hộp thoại riêng: khóa thô chỉ có trong phản hồi tạo, khung CRUD sẽ điều hướng và làm mất nó
  FormDialog: McpKeyCreateDialog,
  formFields: [],
  readOnlyDetail: true,
  auditEntity: 'mcp_key',
  renderToolbarExtra: () => <McpKeyScopeToggle />,
  chips: (row) => [
    { icon: Hash, text: row.prefix, tone: 'code' },
    { icon: ShieldCheck, text: getMcpAccessLevelLabel(row.access_level) || 'Không rõ mức', tone: 'muted' },
    { text: row.status === 'active' ? 'Đang dùng' : row.status === 'expired' ? 'Hết hạn' : 'Đã thu hồi', tone: row.status === 'active' ? 'ok' : 'muted' },
  ],
  detailActions: (row) => <McpKeyRevokeButton mcpKey={row} />,
  renderExtra: (row) => <McpKeyDetailPanel mcpKey={row} />,
}
