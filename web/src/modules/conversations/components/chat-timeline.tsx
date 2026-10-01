import { Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { Button } from '@/shared/ui/button'
import type { ChatMessage } from '../types/conversation'
import { buildTimelineRows, formatDayLabel } from '../utils/format-chat-time'
import { MessageBubble } from './message-bubble'

interface ChatTimelineProps {
  threadId: number
  messages: ChatMessage[]
  isGroup: boolean
  hasOlder: boolean
  isLoadingOlder: boolean
  onLoadOlder: () => void
}

/**
 * Dòng tin xếp theo giờ gửi, ngăn ngày, gộp đợt. Mở cuộc thì cuộn xuống cuối; bấm «Xem tin cũ hơn»
 * thì giữ nguyên vị trí đang đọc (bù chiều cao phần vừa chèn lên trên).
 */
export function ChatTimeline({ threadId, messages, isGroup, hasOlder, isLoadingOlder, onLoadOlder }: ChatTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependRef = useRef<{ height: number; top: number } | null>(null)
  const lastThreadRef = useRef<number | null>(null)
  const lastIdRef = useRef<number | null>(null)

  const handleLoadOlder = () => {
    const node = scrollRef.current
    if (node) prependRef.current = { height: node.scrollHeight, top: node.scrollTop }
    onLoadOlder()
  }

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const lastId = messages.at(-1)?.id ?? null
    if (prependRef.current) {
      node.scrollTop = node.scrollHeight - prependRef.current.height + prependRef.current.top
      prependRef.current = null
    } else if (lastThreadRef.current !== threadId || lastIdRef.current !== lastId) {
      // Cuộc mới mở, hoặc có tin mới tới → về cuối
      node.scrollTop = node.scrollHeight
    }
    lastThreadRef.current = threadId
    lastIdRef.current = lastId
  }, [threadId, messages])

  useEffect(() => {
    prependRef.current = null
  }, [threadId])

  const rows = buildTimelineRows(messages)
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-3">
      {hasOlder && (
        <div className="mb-3 text-center">
          <Button variant="outline" size="sm" onClick={handleLoadOlder} disabled={isLoadingOlder}>
            {isLoadingOlder && <Loader2 className="animate-spin" />}
            Xem tin cũ hơn
          </Button>
        </div>
      )}
      {!messages.length && <p className="py-10 text-center text-sm text-muted-foreground">Chưa có tin nào được lưu trong cuộc này.</p>}
      <div className="flex flex-col gap-1">
        {rows.map(({ message, newDay, firstOfRun, lastOfRun }) => (
          <div key={message.id} className={firstOfRun ? 'mt-2' : undefined}>
            {newDay && (
              <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                {formatDayLabel(message.sent_at)}
              </div>
            )}
            <MessageBubble message={message} isGroup={isGroup} firstOfRun={firstOfRun} lastOfRun={lastOfRun} />
          </div>
        ))}
      </div>
    </div>
  )
}
