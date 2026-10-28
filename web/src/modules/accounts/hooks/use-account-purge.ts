import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { accountApi, ACCOUNTS_API_PATH } from '../api/account-api'

/** Số liệu sẽ mất khi xóa tài khoản thử — chỉ hỏi khi hộp xác nhận đang mở, lần nào mở cũng hỏi lại (số đổi theo tin mới). */
export function useAccountPurgePreview(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accounts.purgePreview(id),
    queryFn: () => accountApi.purgePreview(id),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function usePurgeAccount(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { confirm_label: string; backup_confirmed: boolean }) => accountApi.purge(id, payload),
    onSuccess: (message) => {
      toast.success(message)
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(ACCOUNTS_API_PATH) })
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}
