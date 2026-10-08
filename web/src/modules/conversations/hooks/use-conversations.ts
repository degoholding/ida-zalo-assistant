import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { conversationApi, type ThreadListParams } from '../api/conversation-api'
import type { ChatMessage, MessagesCursor, MessagesPage } from '../types/conversation'

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
 * Dòng tin. Trang 0 là trang mở đầu — tin MỚI NHẤT, hoặc quanh tin `focusMessageId` (`?msg=` từ màn Tệp); trang kế
 * (`fetchNextPage`) là tin CŨ hơn, trang trước (`fetchPreviousPage`) là tin MỚI hơn khi đang xem quanh một tin cũ.
 * Hiện ra thì đảo lại cho cũ trên mới dưới (`flattenMessagePages`). Xếp kiểu này để lần nạp lại (tin mới tới, hỏi vòng)
 * đi từ trang mới nhất lần ngược về trước — không đánh rơi trang nào đã xem.
 */
export function useMessages(id: number | null, focusMessageId: number | null = null) {
  const initialPageParam: MessagesCursor = focusMessageId ? { around: focusMessageId } : {}
  return useInfiniteQuery({
    queryKey: focusMessageId ? queryKeys.conversations.messagesAround(id ?? 0, focusMessageId) : queryKeys.conversations.messages(id ?? 0),
    queryFn: ({ pageParam }) => conversationApi.messages(id ?? 0, pageParam),
    initialPageParam,
    getNextPageParam: (lastPage): MessagesCursor | undefined => (lastPage.older_cursor ? { beforeId: lastPage.older_cursor } : undefined),
    getPreviousPageParam: (firstPage): MessagesCursor | undefined => (firstPage.newer_cursor ? { afterId: firstPage.newer_cursor } : undefined),
    enabled: Boolean(id),
    refetchInterval: FALLBACK_REFRESH_MS,
  })
}

/** Gộp các trang thành một dòng tin cũ trên mới dưới, bỏ tin trùng (hai trang có thể chạm nhau sau một lần nạp lại). */
export function flattenMessagePages(pages: MessagesPage[] | undefined): ChatMessage[] {
  const seen = new Set<number>()
  const items: ChatMessage[] = []
  for (const page of [...(pages ?? [])].reverse()) {
    for (const message of page.items) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      items.push(message)
    }
  }
  return items
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
