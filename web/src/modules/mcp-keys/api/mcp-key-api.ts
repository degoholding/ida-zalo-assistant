import { apiGet, apiPost, httpClient, type SuccessEnvelope } from '@/core/api'
import type { McpKey, McpKeyCreateRequest, McpKeyCreateResult, McpKeyOptions } from '../types/mcp-key'

export const MCP_KEYS_API_PATH = '/api/mcp-keys'

export const mcpKeyApi = {
  getOptions: () => apiGet<McpKeyOptions>(`${MCP_KEYS_API_PATH}/options`),
  /** Khóa thô nằm trong kết quả — người gọi (mutation) phải giữ nó trong state cục bộ, không đưa vào bộ nhớ đệm query. */
  create: (request: McpKeyCreateRequest) => apiPost<McpKeyCreateResult>(MCP_KEYS_API_PATH, request),
  revoke: async (id: number) => {
    const res = await httpClient.post<SuccessEnvelope<McpKey>>(`${MCP_KEYS_API_PATH}/${id}/revoke`)
    return res.data.message
  },
}
