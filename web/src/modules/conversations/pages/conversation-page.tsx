import { MessageCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { CONVERSATION_TYPE } from '@/shared/contact-card/contact-constants'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { getKindLabel } from '@/shared/contact-card/format-contact'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { ErrorState } from '@/shared/ui/error-state'
import { ChatTimeline } from '../components/chat-timeline'
import { ConversationProfilePanel } from '../components/conversation-profile-panel'
import { MessageComposer } from '../components/message-composer'
import { ThreadList, THREAD_TYPE_ALL } from '../components/thread-list'
import { useMessages, useThread, useThreads } from '../hooks/use-conversations'
import { useLiveEvents } from '../hooks/use-live-events'

/**
 * Màn Hội thoại 3 cột kiểu Zalo / Telegram: danh sách | khung chat | hồ sơ. Tin mới tới qua kênh đẩy
 * (SSE); quản trị gõ được từ ô soạn tin dưới khung chat (đi ra dưới tên tài khoản bot). Cuộc đang mở nằm ở URL (`/conversations/:id`) để gửi link được.
 */
export function ConversationPage() {
  const { id } = useParams()
  const selectedId = Number(id) > 0 ? Number(id) : null
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const debouncedQuery = useDebouncedValue(query, 300)
  const typeFilter = Number(searchParams.get('type') ?? THREAD_TYPE_ALL)

  const listParams = useMemo(
    () => ({ q: debouncedQuery || undefined, thread_type: typeFilter >= 0 ? typeFilter : undefined }),
    [debouncedQuery, typeFilter],
  )
  useLiveEvents()
  const threads = useThreads(listParams)
  const thread = useThread(selectedId)
  const messages = useMessages(selectedId)
  const items = useMemo(() => messages.data?.pages.flatMap((page) => page.items) ?? [], [messages.data])

  const handleTypeFilterChange = (value: number) => {
    const next = new URLSearchParams(searchParams)
    if (value === THREAD_TYPE_ALL) next.delete('type')
    else next.set('type', String(value))
    setSearchParams(next, { replace: true })
  }

  const detail = thread.data
  const isGroup = detail?.thread_type === CONVERSATION_TYPE.group
  const botName = detail?.bot_name ?? 'bot'
  const subtitle = !detail
    ? ''
    : isGroup
      ? `Nhóm · ${detail.group?.member_count ?? 0} thành viên`
      : detail.contact
        ? `${getKindLabel(detail.contact.kind)} · nhắn riêng với bot`
        : 'Nhắn riêng với bot'

  return (
    <div className="flex h-full min-h-0">
      <ThreadList
        threads={threads.data?.items ?? []}
        selectedId={selectedId}
        query={query}
        onQueryChange={setQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={handleTypeFilterChange}
        isLoading={threads.isLoading}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        {!selectedId && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageCircle className="size-12 opacity-40" />
            <p className="text-sm">Chọn một cuộc trò chuyện bên trái để xem tin nhắn.</p>
          </div>
        )}
        {selectedId && thread.isError && <ErrorState title="Không có cuộc trò chuyện này" description="Cuộc này có thể đã bị dọn, hoặc đường dẫn sai." />}
        {detail && (
          <>
            <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
              <EntityAvatar name={detail.display_name} avatarUrl={detail.avatar_url} shape={isGroup ? 'rounded' : 'circle'} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-navy">{detail.display_name}</div>
                <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
              </div>
            </header>
            <ChatTimeline
              threadId={detail.id}
              messages={items}
              isGroup={isGroup}
              hasOlder={Boolean(messages.hasPreviousPage)}
              isLoadingOlder={messages.isFetchingPreviousPage}
              onLoadOlder={() => void messages.fetchPreviousPage()}
            />
            <MessageComposer threadId={detail.id} botName={botName} />
          </>
        )}
      </section>
      {detail && <ConversationProfilePanel thread={detail} />}
    </div>
  )
}
