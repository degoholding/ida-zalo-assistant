import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { conversationApi, type ThreadListParams } from '../api/conversation-api'

/** Lưới đỡ khi kênh đẩy (SSE) đứt: hỏi lại mỗi 60 giây. Bình thường tin mới tới qua `useLiveEvents`. */
const FALLBACK_REFRESH_MS = 60_000

export function useThreads(params: ThreadListParams) {
  return useQuery({
    queryKey: queryKeys.conversations.list({ ...params }),
    queryFn: () => conversationApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: FALLBACK_REFRESH_MS,
  })
}

export function useThread(id: number | null) {
  return useQuery({
    queryKey: queryKeys.conversations.thread(id ?? 0),
    queryFn: () => conversationApi.thread(id ?? 0),
    enabled: Boolean(id),
  })
}

/**
 * Dòng tin: trang đầu là tin MỚI NHẤT; «Xem tin cũ hơn» nối thêm trang về phía trước
 * (`fetchPreviousPage`). Tin mới tới thì `useLiveEvents` làm mới trang đầu.
 */
export function useMessages(id: number | null) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversations.messages(id ?? 0),
    queryFn: ({ pageParam }) => conversationApi.messages(id ?? 0, pageParam),
    initialPageParam: 0,
    getNextPageParam: () => undefined,
    getPreviousPageParam: (firstPage) => firstPage.older_cursor ?? undefined,
    enabled: Boolean(id),
    refetchInterval: FALLBACK_REFRESH_MS,
  })
}

function useRefreshThread(id: number) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(id) })
    void queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] })
  }
}

export function useSendText(id: number) {
  const refresh = useRefreshThread(id)
  return useMutation({
    mutationFn: (text: string) => conversationApi.sendText(id, text),
    onSuccess: refresh,
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 8000 }),
  })
}

export function useSendFile(id: number) {
  const refresh = useRefreshThread(id)
  return useMutation({
    mutationFn: (file: File) => conversationApi.sendFile(id, file),
    onSuccess: ({ message }) => {
      toast.success(message)
      refresh()
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 8000 }),
  })
}
