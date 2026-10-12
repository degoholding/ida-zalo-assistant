import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { queryKeys } from '@/shared/constants/query-keys'
import { botHaltApi } from './bot-halt-api'

/** Tắt / Bật bot khẩn (chỉ quản trị — máy chủ chặn người khác). Xong thì đặt ngay tình trạng mới cho dải đỏ khỏi chờ 30 giây. */
export function useSetBotHalt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: botHaltApi.setHalted,
    onSuccess: (result) => {
      toast.success(result.message || 'Đã cập nhật tình trạng bot')
      queryClient.setQueryData(queryKeys.botHalt.status(), result.status)
      void queryClient.invalidateQueries({ queryKey: queryKeys.botHalt.all })
    },
  })
}
