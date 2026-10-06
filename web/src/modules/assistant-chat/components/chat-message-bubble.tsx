import { FileSpreadsheet } from 'lucide-react'

import { fileDownloadUrl } from '@/shared/constants/app-routes'
import { cn } from '@/shared/utils/cn'
import { formatTime } from '@/shared/utils/format-date'
import type { ChatMessage } from '../types/assistant-chat'
import { autolinkText } from '../utils/autolink-text'

/** Chữ thường + link bấm mở tab mới — URL tự nhận ra bằng `autolinkText`, không render HTML thô. */
function MessageText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {autolinkText(text).map((segment, index) =>
        segment.type === 'link' ? (
          <a
            key={index}
            href={segment.value}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </div>
  )
}

interface ChatMessageBubbleProps {
  message: ChatMessage
}

/** Người hỏi bên phải (màu chủ đạo), trợ lý bên trái — cùng khuôn với bong bóng ở màn Hội thoại. */
export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const fromUser = message.role === 'user'
  return (
    <div className={cn('flex', fromUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          fromUser ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border bg-background',
        )}
      >
        {message.file ? (
          <a
            href={fileDownloadUrl(message.file.attachment_id)}
            download
            className={cn(
              'flex items-center gap-2 rounded-lg p-1 underline-offset-2 hover:underline',
              fromUser && 'text-primary-foreground',
            )}
          >
            <FileSpreadsheet className="size-4 shrink-0" />
            <span className="truncate">{message.file.file_name}</span>
          </a>
        ) : (
          message.text && <MessageText text={message.text} />
        )}
        <span className={cn('mt-0.5 block text-right text-[10px]', fromUser ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {formatTime(message.sent_at)}
        </span>
      </div>
    </div>
  )
}
