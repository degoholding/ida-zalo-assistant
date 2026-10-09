import { ArrowUpRight } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import type { MessageSearchRecord } from '../types/message-search'
import { splitHighlights } from '../utils/split-highlights'

interface MessageSnippetCellProps {
  message: MessageSearchRecord
}

/** Đoạn trích tô sáng từ khóa + nút mở đúng tin trong hội thoại (thấy luôn các tin trước và sau). */
export function MessageSnippetCell({ message }: MessageSnippetCellProps) {
  const [searchParams] = useSearchParams()
  const parts = splitHighlights(message.snippet || '', searchParams.get('q') ?? '')

  return (
    <div className="flex min-w-0 items-start gap-2">
      <p className="min-w-0 flex-1 text-sm leading-relaxed whitespace-normal">
        {parts.map((part, index) =>
          part.match ? (
            <mark key={index} className="rounded-sm bg-warning/30 px-0.5 text-foreground">
              {part.text}
            </mark>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </p>
      <Link
        to={appRoutes.conversations.message(message.thread_id, message.id)}
        className="inline-flex shrink-0 items-center gap-0.5 text-xs text-primary hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        Xem trong hội thoại <ArrowUpRight className="size-3.5" />
      </Link>
    </div>
  )
}
