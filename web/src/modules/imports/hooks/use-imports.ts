import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { importApi } from '../api/import-api'
import type { SeatInfo } from '../types/import'

const GROUPS_API_PATH = '/api/groups'
/** Ghế đang có người (đã đăng nhập / đang chạy việc) thì hỏi dày hơn; đang chờ quét QR hay tắt thì thưa hơn. */
const SEAT_POLL_ACTIVE_MS = 3000
const SEAT_POLL_IDLE_MS = 8000

/** Trạng thái ghế đồng bộ Zalo PC (phase 14.6). Chưa cấu hình (`configured: false`) thì thôi hỏi lại. */
export function useSeatStatus() {
  return useQuery({
    queryKey: queryKeys.imports.seat(),
    queryFn: importApi.seat,
    refetchInterval: (query) => {
      const info = query.state.data as SeatInfo | undefined
      if (info && !info.configured) return false
      return info?.status?.phase === 'main' ? SEAT_POLL_ACTIVE_MS : SEAT_POLL_IDLE_MS
    },
    retry: false,
  })
}

/** Cuộc đã có tin cũ trong kho; hỏi lại đều đặn khi ghế đang nạp (`active`). */
export function useImportResults(active = false) {
  return useQuery({
    queryKey: queryKeys.imports.results(),
    queryFn: importApi.results,
    refetchInterval: active ? 10_000 : false,
  })
}

export function useSeatLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: importApi.seatLogout,
    onSuccess: (message) => {
      toast.success(message)
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.seat() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.results() })
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(GROUPS_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 10_000 }),
  })
}
