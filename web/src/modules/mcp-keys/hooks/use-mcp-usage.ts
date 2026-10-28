import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { mcpUsageApi } from '../api/mcp-usage-api'
import type { McpUsageQuery } from '../types/mcp-usage'

/** Thống kê dùng MCP theo bộ lọc; `enabled` = người xem là quản trị (người khác máy chủ trả 403). */
export function useMcpUsage(query: McpUsageQuery, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.mcpKeys.usage({ ...query }),
    queryFn: () => mcpUsageApi.get(query),
    enabled,
    placeholderData: keepPreviousData,
  })
}
