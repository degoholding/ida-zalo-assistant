import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { accountApi, ACCOUNTS_API_PATH } from '../api/account-api'
import type { QrLoginState } from '../types/account'

const POLL_MS = 2000

export function useStartQrLogin() {
  return useMutation({
    mutationFn: (label: string) => accountApi.startQrLogin(label),
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}

/** Hỏi trạng thái lượt quét 2 giây một lần; xong (thành / hỏng) thì thôi hỏi và nạp lại danh sách tài khoản. */
export function useQrLoginState(attemptId: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: queryKeys.accounts.qrLogin(attemptId ?? ''),
    queryFn: () => accountApi.getQrLogin(attemptId ?? ''),
    enabled: Boolean(attemptId),
    refetchInterval: (query) => {
      const state = query.state.data as QrLoginState | undefined
      if (state?.phase === 'success') void queryClient.invalidateQueries({ queryKey: getCrudRootKey(ACCOUNTS_API_PATH) })
      return state?.phase === 'success' || state?.phase === 'failed' ? false : POLL_MS
    },
    retry: false,
  })
}
