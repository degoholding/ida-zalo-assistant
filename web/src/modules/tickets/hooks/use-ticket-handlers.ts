import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { queryKeys } from '@/shared/constants/query-keys'
import { ticketApi } from '../api/ticket-api'

/** Danh sách người xử lý ticket. */
export function useTicketHandlers() {
  return useQuery({
    queryKey: queryKeys.tickets.handlers(),
    queryFn: ticketApi.listHandlers,
  })
}

/** Thêm / bỏ người xử lý — chỉ quản trị (máy chủ gác bằng `setting.write`). */
export function useTicketHandlerMutations() {
  const queryClient = useQueryClient()
  const refresh = (message: string | undefined, fallback: string) => {
    toast.success(message || fallback)
    void queryClient.invalidateQueries({ queryKey: queryKeys.tickets.handlers() })
  }
  const add = useMutation({
    mutationFn: (contactId: number) => ticketApi.addHandler(contactId),
    onSuccess: (message) => refresh(message, 'Đã thêm người xử lý'),
  })
  const remove = useMutation({
    mutationFn: (contactId: number) => ticketApi.removeHandler(contactId),
    onSuccess: (message) => refresh(message, 'Đã bỏ người xử lý'),
  })
  return { add, remove }
}
