import { apiGet } from '@/core/api'
import type { McpUsage, McpUsageQuery } from '../types/mcp-usage'

/** Chỉ quản trị — máy chủ chặn người khác (đường không khai ở route-permissions). */
export const MCP_USAGE_API_PATH = '/api/mcp-usage'

export const mcpUsageApi = {
  get: (query: McpUsageQuery) => apiGet<McpUsage>(MCP_USAGE_API_PATH, { params: query }),
}
