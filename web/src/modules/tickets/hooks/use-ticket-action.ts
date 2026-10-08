import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { ticketApi, TICKETS_API_PATH } from '../api/ticket-api'
import type { TicketActionRequest } from '../types/ticket'

/**
 * Nhận / xong / hủy / mở lại / nhắn người gửi. Xong thì toast câu máy chủ nói và làm mới CẢ danh sách lẫn chi tiết
 * (cùng gốc khóa `['crud', '/api/tickets']`) — trạng thái đổi thì dòng ngoài danh sách cũng phải đổi theo.
 */
export function useTicketAction(ticketId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: TicketActionRequest) => ticketApi.runAction(ticketId, request),
    onSuccess: (result) => {
      toast.success(result.message || 'Đã cập nhật ticket')
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(TICKETS_API_PATH) })
    },
  })
}
