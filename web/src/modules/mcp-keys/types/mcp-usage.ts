/** Bộ đếm một nhóm lời gọi — khớp `shapeCounts` ở `src/web/api/mcp-usage-api.ts`. */
export interface McpUsageCounts {
  calls: number
  ok: number
  /** Lỗi hệ thống (McpCallStatus.Error). */
  errors: number
  /** Bị chặn quyền + tham số sai. */
  rejected: number
  rate_limited: number
  avg_ms: number
  p95_ms: number
  /** Số dòng / bản ghi trả ra. */
  rows: number
  /** Số ký tự trả cho AI (khối chữ + tệp nhúng). */
  chars: number
  /** Ước lượng token = ký tự / 4. */
  est_tokens: number
}

export interface McpUsageDailyRow extends McpUsageCounts {
  day: string
  subject_id: number | null
  subject_name: string
  owner_name: string
}

export interface McpUsageToolRow extends McpUsageCounts {
  tool: string
}

export type McpUsageGroupBy = 'key' | 'user'
export type McpUsageSource = 'http' | 'all'

export interface McpUsageQuery {
  days: number
  group: McpUsageGroupBy
  source: McpUsageSource
}

export interface McpUsage {
  since: string
  days: number
  group_by: McpUsageGroupBy
  totals: McpUsageCounts
  daily: McpUsageDailyRow[]
  truncated: boolean
  top_tools: McpUsageToolRow[]
}

/** Khoảng ngày chọn được — máy chủ nhận 1–90 (`USAGE_MAX_DAYS`). */
export const MCP_USAGE_DAY_OPTIONS = [
  { value: 1, label: 'Hôm nay' },
  { value: 7, label: '7 ngày' },
  { value: 30, label: '30 ngày' },
  { value: 90, label: '90 ngày' },
]

export const MCP_USAGE_GROUP_OPTIONS: { value: McpUsageGroupBy; label: string }[] = [
  { value: 'key', label: 'Theo khóa' },
  { value: 'user', label: 'Theo người' },
]

export const MCP_USAGE_SOURCE_OPTIONS: { value: McpUsageSource; label: string }[] = [
  { value: 'http', label: 'Cổng MCP ngoài' },
  { value: 'all', label: 'Cả trợ lý trong app' },
]
