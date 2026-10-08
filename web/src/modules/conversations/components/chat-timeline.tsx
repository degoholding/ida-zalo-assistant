import { ArrowDownToLine, Loader2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils/cn'
import type { ChatMessage } from '../types/conversation'
import { buildTimelineRows, formatDayLabel } from '../utils/format-chat-time'
import { MessageBubble } from './message-bubble'

/** Tin được trỏ tới (`?msg=`) sáng lên ngần này rồi tắt. */
const HIGHLIGHT_MS = 2500
/** Cách đáy dưới ngần này px coi như «đang ở cuối» — tin mới tới thì bám theo xuống. */
const NEAR_BOTTOM_PX = 80

interface ChatTimelineProps {
  threadId: number
  messages: ChatMessage[]
  isGroup: boolean
  hasOlder: boolean
  isLoadingOlder: boolean
  onLoadOlder: () => void
  /** Còn tin mới hơn chưa nạp (đang xem quanh một tin cũ). */
  hasNewer?: boolean
  isLoadingNewer?: boolean
  onLoadNewer?: () => void
  /** Bỏ chế độ xem quanh một tin, về tin mới nhất. */
  onJumpToLatest?: () => void
  /** Tin cần cuộn tới + làm sáng (`?msg=` trên URL); null = mở ở cuối như thường. */
  focusMessageId?: number | null
}

/**
 * Dòng tin xếp theo giờ gửi, ngăn ngày, gộp đợt. Mở cuộc thì cuộn xuống cuối — hoặc tới đúng tin `focusMessageId`
 * (làm sáng một lúc). «Xem tin cũ hơn» giữ nguyên vị trí đang đọc (bù chiều cao phần vừa chèn lên trên); «Xem tin mới
 * hơn» nối xuống dưới, không nhảy.
 */
export function ChatTimeline({
  threadId, messages, isGroup, hasOlder, isLoadingOlder, onLoadOlder, hasNewer = false, isLoadingNewer = false, onLoadNewer, onJumpToLatest,
  focusMessageId = null,
}: ChatTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependRef = useRef<{ height: number; top: number } | null>(null)
  const appendRef = useRef(false)
  const lastThreadRef = useRef<number | null>(null)
  const lastIdRef = useRef<number | null>(null)
  const nearBottomRef = useRef(true)
  // Tin đã cuộn tới rồi (theo cặp cuộc + tin) — nạp thêm trang không kéo người đọc về lại tin đó
  const focusedKeyRef = useRef<string | null>(null)
  const focusKey = focusMessageId ? `${threadId}:${focusMessageId}` : null
  const focusLoaded = focusMessageId !== null && messages.some((message) => message.id === focusMessageId)
  // Làm sáng tin được trỏ tới khi nó đã hiện, tắt sau HIGHLIGHT_MS (nhớ theo cặp cuộc + tin)
  const [fadedKey, setFadedKey] = useState<string | null>(null)
  const highlightId = focusKey && focusLoaded && fadedKey !== focusKey ? focusMessageId : null

  const handleLoadOlder = () => {
    const node = scrollRef.current
    if (node) prependRef.current = { height: node.scrollHeight, top: node.scrollTop }
    onLoadOlder()
  }

  const handleLoadNewer = () => {
    appendRef.current = true
    onLoadNewer?.()
  }

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const lastId = messages.at(-1)?.id ?? null
    const focusTarget = focusKey && focusedKeyRef.current !== focusKey
      ? node.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`)
      : null
    if (prependRef.current) {
      node.scrollTop = node.scrollHeight - prependRef.current.height + prependRef.current.top
      prependRef.current = null
    } else if (appendRef.current) {
      // Trang mới hơn nối xuống dưới: giữ nguyên chỗ đang đọc
      appendRef.current = false
    } else if (focusTarget && focusKey) {
      focusedKeyRef.current = focusKey
      // jsdom không có scrollIntoView — gọi có điều kiện
      focusTarget.scrollIntoView?.({ block: 'center' })
    } else if (lastThreadRef.current !== threadId || lastIdRef.current !== lastId) {
      // Cuộc mới mở, hoặc có tin mới tới → về cuối; đang xem quanh một tin cũ thì chỉ bám xuống khi đang ở cuối
      const threadChanged = lastThreadRef.current !== threadId
      const follow = !focusKey || (!threadChanged && nearBottomRef.current && !hasNewer)
      if (follow) node.scrollTop = node.scrollHeight
    }
    lastThreadRef.current = threadId
    lastIdRef.current = lastId
  }, [threadId, messages, focusKey, focusMessageId, hasNewer])

  useEffect(() => {
    prependRef.current = null
    appendRef.current = false
  }, [threadId])

  useEffect(() => {
    if (!focusKey || !focusLoaded) return
    const timer = setTimeout(() => setFadedKey(focusKey), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [focusKey, focusLoaded])

  const handleScroll = () => {
    const node = scrollRef.current
    if (node) nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM_PX
  }

  const rows = buildTimelineRows(messages)
  return (
    <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-3">
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
          <div
            key={message.id}
            data-message-id={message.id}
            aria-current={highlightId === message.id ? 'true' : undefined}
            className={cn(
              'rounded-lg transition-colors duration-700',
              firstOfRun && 'mt-2',
              highlightId === message.id && 'bg-warning/20 ring-2 ring-warning/60',
            )}
          >
            {newDay && (
              <div className="my-3 flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                {formatDayLabel(message.sent_at)}
              </div>
            )}
            <MessageBubble message={message} isGroup={isGroup} firstOfRun={firstOfRun} lastOfRun={lastOfRun} />
          </div>
        ))}
      </div>
      {(hasNewer || focusMessageId) && (
        <div className="mt-3 flex justify-center gap-2">
          {hasNewer && (
            <Button variant="outline" size="sm" onClick={handleLoadNewer} disabled={isLoadingNewer}>
              {isLoadingNewer && <Loader2 className="animate-spin" />}
              Xem tin mới hơn
            </Button>
          )}
          {onJumpToLatest && (
            <Button variant="ghost" size="sm" onClick={onJumpToLatest}>
              <ArrowDownToLine />
              Về tin mới nhất
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
