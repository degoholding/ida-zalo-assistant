import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { aiKeyApi } from '../api/ai-key-api'
import type { AiKeyInput, AiKeyPatch } from '../types/ai-key'

/** Danh sách khóa AI theo thứ tự bot dùng. */
export function useAiKeys() {
  return useQuery({ queryKey: queryKeys.aiKeys.list(), queryFn: aiKeyApi.list })
}

/** Thêm / sửa / đưa lên / gỡ — một hook cho cả bốn, cùng toast và cùng nạp lại danh sách. */
export function useAiKeyMutations() {
  const queryClient = useQueryClient()
  const onSuccess = ({ message }: { message: string }) => {
    toast.success(message)
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiKeys.all })
  }
  const onError = (error: unknown) => toast.error(extractErrorMessage(error))
  return {
    add: useMutation({ mutationFn: (body: AiKeyInput) => aiKeyApi.add(body), onSuccess, onError }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: AiKeyPatch }) => aiKeyApi.update(id, body),
      onSuccess,
      onError,
    }),
    moveUp: useMutation({ mutationFn: (id: number) => aiKeyApi.moveUp(id), onSuccess, onError }),
    remove: useMutation({ mutationFn: (id: number) => aiKeyApi.remove(id), onSuccess, onError }),
  }
}
