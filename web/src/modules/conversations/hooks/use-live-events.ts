import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { queryKeys } from '@/shared/constants/query-keys'

/** Khớp `MessageEvent` ở `src/live-events.ts` của máy chủ. */
interface LiveMessageEvent {
  threadId: number
  messageId: number
  kind: 'new' | 'recalled' | 'thread_updated'
}

const EVENTS_URL = '/api/events'

/**
 * Nghe kênh đẩy của máy chủ (SSE): tin vừa lưu / thu hồi / cuộc đổi tên → nạp lại dòng tin, thẻ cuộc và cột trái
 * ngay, không chờ hỏi vòng. Mất kết nối thì trình duyệt tự nối lại (EventSource có sẵn), hỏi vòng
 * 60 giây trong `use-conversations.ts` là lưới đỡ.
 */
export function useLiveEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const source = new EventSource(EVENTS_URL, { withCredentials: true })
    const handle = (event: Event) => {
      const data = JSON.parse((event as MessageEvent).data) as LiveMessageEvent
      // thread_updated (đổi tên nhóm, người vào/ra): không có tin mới, chỉ thông tin cuộc đổi
      if (data.kind !== 'thread_updated') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.messages(data.threadId) })
      }
      void queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.thread(data.threadId) })
    }
    source.addEventListener('message', handle)
    return () => {
      source.removeEventListener('message', handle)
      source.close()
    }
  }, [queryClient])
}
