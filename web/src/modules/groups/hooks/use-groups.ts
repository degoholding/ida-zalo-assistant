import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { groupApi, GROUPS_API_PATH } from '../api/group-api'

/** «Lấy tin cũ»: hỏi Zalo tin gần nhất của nhóm. Câu trả lời (lấy được bao nhiêu / vì sao không) hiện thành toast. */
export function useBackfillGroup(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => groupApi.backfill(id),
    onSuccess: ({ message }) => {
      toast.success(message, { duration: 8000 })
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(GROUPS_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 8000 }),
  })
}
