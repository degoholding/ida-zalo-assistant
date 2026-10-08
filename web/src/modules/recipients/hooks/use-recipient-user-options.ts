import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { recipientApi } from '../api/recipient-api'

/** Danh sách tài khoản web cho ô «Tài khoản web» của người nhận. */
export function useRecipientUserOptions() {
  return useQuery({
    queryKey: queryKeys.recipients.userOptions(),
    queryFn: recipientApi.listUserOptions,
    staleTime: 60_000,
  })
}
