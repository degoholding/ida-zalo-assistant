import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { queryKeys } from '@/shared/constants/query-keys'
import { mcpKeyApi, MCP_KEYS_API_PATH } from '../api/mcp-key-api'
import type { McpKeyCreateRequest } from '../types/mcp-key'

/** Giới hạn tạo khóa của người đang đăng nhập; chỉ nạp khi hộp thoại tạo mở (`enabled`). */
export function useMcpKeyOptions(enabled = true) {
  return useQuery({ queryKey: queryKeys.mcpKeys.options(), queryFn: mcpKeyApi.getOptions, enabled, staleTime: 60_000 })
}

/**
 * Tạo khóa. Khóa thô chỉ đi qua `mutateAsync` về state cục bộ của hộp thoại — `gcTime: 0` để kết quả không nằm lại
 * trong bộ nhớ đệm mutation sau khi hộp thoại đóng. Lỗi thì `http-client` tự bật toast đỏ.
 */
export function useMcpKeyCreate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: McpKeyCreateRequest) => mcpKeyApi.create(request),
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(MCP_KEYS_API_PATH) })
    },
  })
}

/** Thu hồi khóa, rồi làm mới cả danh sách lẫn chi tiết (cùng gốc khóa của khung CRUD). */
export function useMcpKeyRevoke() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => mcpKeyApi.revoke(id),
    onSuccess: (message) => {
      toast.success(message || 'Đã thu hồi khóa')
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(MCP_KEYS_API_PATH) })
    },
  })
}
