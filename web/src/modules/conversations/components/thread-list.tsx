import { Hash, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CONVERSATION_TYPE } from '@/shared/contact-card/contact-constants'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/utils/cn'
import type { Thread } from '../types/conversation'
import { formatShortTime } from '../utils/format-chat-time'

/** Lọc loại cuộc: -1 = tất cả. */
export const THREAD_TYPE_ALL = -1

const TYPE_TABS: [number, string][] = [
  [THREAD_TYPE_ALL, 'Tất cả'],
  [CONVERSATION_TYPE.direct, 'Riêng'],
  [CONVERSATION_TYPE.group, 'Nhóm'],
]

interface ThreadListProps {
  threads: Thread[]
  selectedId: number | null
  query: string
  onQueryChange: (value: string) => void
  typeFilter: number
  onTypeFilterChange: (value: number) => void
  isLoading: boolean
}

function previewOf(thread: Thread): string {
  if (thread.last_text) {
    const prefix = thread.thread_type === CONVERSATION_TYPE.group && thread.last_sender ? `${thread.last_sender}: ` : thread.last_from_bot ? 'Bot: ' : ''
    return `${prefix}${thread.last_text}`.replace(/\s+/g, ' ')
  }
  return thread.message_count ? '(tệp / ảnh)' : 'Chưa có tin'
}

/** Cột trái kiểu Zalo: ô tìm, ba tab loại, danh sách cuộc xếp theo tin gần nhất. */
export function ThreadList({ threads, selectedId, query, onQueryChange, typeFilter, onTypeFilterChange, isLoading }: ThreadListProps) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r bg-background max-lg:w-72">
      <div className="relative p-3 pb-2">
        <Search className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Tìm người hoặc nhóm" className="h-9 pl-9" aria-label="Tìm cuộc trò chuyện" />
      </div>
      <nav className="flex gap-1 border-b px-3 pb-2" aria-label="Loại cuộc trò chuyện">
        {TYPE_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onTypeFilterChange(value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              value === typeFilter ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!threads.length && (
          <p className="p-4 text-center text-sm text-muted-foreground">{isLoading ? 'Đang tải…' : query ? 'Không có cuộc nào khớp.' : 'Chưa có cuộc trò chuyện nào.'}</p>
        )}
        {threads.map((thread) => {
          const isGroup = thread.thread_type === CONVERSATION_TYPE.group
          const active = thread.id === selectedId
          return (
            <Link
              key={thread.id}
              to={appRoutes.conversations.detail(thread.id)}
              className={cn('flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted', active && 'bg-primary/10 hover:bg-primary/10')}
              aria-current={active ? 'page' : undefined}
            >
              <EntityAvatar name={thread.display_name} avatarUrl={thread.avatar_url} shape={isGroup ? 'rounded' : 'circle'} className="size-11" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-navy">
                    {isGroup && <Hash className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{thread.display_name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatShortTime(thread.last_message_at)}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{previewOf(thread)}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}
