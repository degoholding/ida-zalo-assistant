import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { ChatMessage } from '../types/assistant-chat'
import { ChatMessageBubble } from './chat-message-bubble'

interface ChatMessageListProps {
  messages: ChatMessage[]
  /** Đang chờ trợ lý trả lời (3-15s) — hiện chỉ báo, khoá ô soạn ở `ChatComposer`. */
  isAnswering: boolean
}

/** Khung chat cuộn trong: tin mới tới (hoặc chỉ báo đang trả lời xuất hiện) thì tự cuộn xuống cuối. */
export function ChatMessageList({ messages, isAnswering }: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, isAnswering])

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-3">
      <div className="flex flex-col gap-2">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} />
        ))}
        {isAnswering && (
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md border bg-background px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Trợ lý đang trả lời…
          </div>
        )}
      </div>
    </div>
  )
}
