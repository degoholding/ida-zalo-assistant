/** Mức quyền của khóa MCP — khớp `McpAccessLevel` ở `src/constants.ts`; đổi bên đó thì sửa tay bên này. */
export const MCP_ACCESS_LEVEL = { read: 1, readWrite: 2 } as const

/** Kết quả một lời gọi công cụ — khớp `McpCallStatus` ở `src/constants.ts`. */
export const MCP_CALL_STATUS = { ok: 0, denied: 1, invalid: 2, error: 3, rateLimited: 4 } as const

/** Cổng gọi — khớp `McpCallSource` ở `src/constants.ts`. */
export const MCP_CALL_SOURCE = { http: 1, assistant: 2 } as const

export const MCP_ACCESS_LEVEL_OPTIONS = [
  { value: MCP_ACCESS_LEVEL.read, label: 'Chỉ đọc' },
  { value: MCP_ACCESS_LEVEL.readWrite, label: 'Đọc và ghi' },
]

/** Trạng thái khóa do máy chủ suy ra từ `revoked_at` / `expires_at` — khớp `STATUS_SQL` ở `src/web/api/mcp-keys-api.ts`. */
export type McpKeyStatus = 'active' | 'expired' | 'revoked'

export const MCP_KEY_STATUS_OPTIONS: { value: McpKeyStatus; label: string }[] = [
  { value: 'active', label: 'Đang dùng' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'revoked', label: 'Đã thu hồi' },
]

const MCP_CALL_STATUS_LABELS: Record<number, string> = {
  [MCP_CALL_STATUS.ok]: 'Thành công',
  [MCP_CALL_STATUS.denied]: 'Bị từ chối',
  [MCP_CALL_STATUS.invalid]: 'Tham số sai',
  [MCP_CALL_STATUS.error]: 'Lỗi hệ thống',
  [MCP_CALL_STATUS.rateLimited]: 'Quá nhịp',
}

/** Mã lạ (máy chủ thêm mã mà giao diện chưa chép) → chuỗi rỗng, không làm vỡ màn. */
export function getMcpAccessLevelLabel(level: number): string {
  return MCP_ACCESS_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? ''
}

export function getMcpKeyStatusLabel(status: string): string {
  return MCP_KEY_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? ''
}

export function getMcpCallStatusLabel(status: number): string {
  return MCP_CALL_STATUS_LABELS[status] ?? ''
}

/** Một khóa như `GET /api/mcp-keys` trả về — KHÔNG có khóa thô lẫn băm. */
export interface McpKey {
  [key: string]: unknown
  id: number
  user_id: number
  name: string
  prefix: string
  access_level: number
  include_confidential: boolean
  expires_at: string | null
  last_used_at: string | null
  last_used_ip: string | null
  revoked_at: string | null
  created_at: string
  owner_name: string
  status: McpKeyStatus
}

export interface McpCallLogRow {
  id: number
  created_at: string
  tool: string
  entity: string | null
  status: number
  row_count: number
  duration_ms: number
  error_code: string | null
}

export interface McpKeyDetail extends McpKey {
  /** Chỉ có ở `GET /api/mcp-keys/:id`; dòng của danh sách không mang */
  recent_calls?: McpCallLogRow[]
}

/** `GET /api/mcp-keys/options` — giới hạn của chính người đang đăng nhập. */
export interface McpKeyOptions {
  max_access_level: number
  can_include_confidential: boolean
  expiry_days: number[]
  is_admin: boolean
}

export interface McpKeyCreateRequest {
  name: string
  access_level: number
  include_confidential: boolean
  /** null = không hết hạn */
  expires_in_days: number | null
}

/** Phản hồi tạo khóa: `token` là khóa thô, CHỈ có ở đây. */
export interface McpKeyCreateResult {
  key: McpKey
  token: string
}
