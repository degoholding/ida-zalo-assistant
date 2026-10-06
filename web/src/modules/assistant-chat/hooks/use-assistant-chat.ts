import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { assistantChatApi } from '../api/assistant-chat-api'
import type { ChatMessage } from '../types/assistant-chat'
import { createOptimisticQuestion, mergeChatMessages } from '../utils/merge-chat-messages'

/** Người hỏi được + trạng thái bật/tắt của trợ lý — tải một lần khi vào màn. */
export function useAskers() {
  return useQuery({ queryKey: queryKeys.assistantChat.askers(), queryFn: assistantChatApi.askers })
}

export function useChatMessages(contactId: number | null) {
  return useQuery({
    queryKey: queryKeys.assistantChat.messages(contactId ?? 0),
    queryFn: () => assistantChatApi.messages(contactId ?? 0),
    enabled: Boolean(contactId),
  })
}

/**
 * Gửi câu hỏi: hiện NGAY một bong bóng tạm (người dùng thấy câu mình vừa gõ trong khi
 * chờ 3-15s), rồi khi máy chủ trả lời thì gộp câu hỏi thật + câu trả lời + tệp báo cáo
 * vào đúng cuộc đó (`mergeChatMessages` bỏ bong bóng tạm, không nhân đôi theo id).
 */
export function useSendQuestion(contactId: number | null) {
  const queryClient = useQueryClient()
  const key = queryKeys.assistantChat.messages(contactId ?? 0)

  return useMutation({
    mutationFn: (question: string) => assistantChatApi.sendQuestion(contactId ?? 0, question),
    onMutate: (question) => {
      if (!contactId) return
      queryClient.setQueryData<ChatMessage[]>(key, (current) => [...(current ?? []), createOptimisticQuestion(question)])
    },
    onSuccess: (result) => {
      if (!contactId) return
      queryClient.setQueryData<ChatMessage[]>(key, (current) => mergeChatMessages(current ?? [], result.messages))
    },
    onError: (error) => {
      if (contactId) {
        queryClient.setQueryData<ChatMessage[]>(key, (current) => mergeChatMessages(current ?? [], []))
      }
      toast.error(extractErrorMessage(error), { duration: 8000 })
    },
  })
}
