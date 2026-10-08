import { MessageCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { CONVERSATION_TYPE } from '@/shared/contact-card/contact-constants'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { getKindLabel } from '@/shared/contact-card/format-contact'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'
import { ChatTimeline } from '../components/chat-timeline'
import { ConversationProfilePanel } from '../components/conversation-profile-panel'
import { MessageComposer } from '../components/message-composer'
import { ThreadList, THREAD_TYPE_ALL } from '../components/thread-list'
import { flattenMessagePages, useMessages, useThread, useThreads } from '../hooks/use-conversations'
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
  // `?msg=<id tin>` (màn Tệp «Xem trong hội thoại»): mở cuộc quanh đúng tin đó, cuộn tới và làm sáng
  const focusMessageId = Number(searchParams.get('msg')) > 0 ? Number(searchParams.get('msg')) : null
  const messages = useMessages(selectedId, focusMessageId)
  const items = useMemo(() => flattenMessagePages(messages.data?.pages), [messages.data])

  const handleJumpToLatest = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('msg')
    setSearchParams(next, { replace: true })
  }

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
            {focusMessageId && messages.isError ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
                <p className="text-sm text-muted-foreground">Không tìm thấy tin này trong cuộc — có thể tin đã bị dọn theo hạn giữ.</p>
                <Button variant="outline" size="sm" onClick={handleJumpToLatest}>
                  Về tin mới nhất
                </Button>
              </div>
            ) : (
              <ChatTimeline
                threadId={detail.id}
                messages={items}
                isGroup={isGroup}
                hasOlder={Boolean(messages.hasNextPage)}
                isLoadingOlder={messages.isFetchingNextPage}
                onLoadOlder={() => void messages.fetchNextPage()}
                hasNewer={Boolean(messages.hasPreviousPage)}
                isLoadingNewer={messages.isFetchingPreviousPage}
                onLoadNewer={() => void messages.fetchPreviousPage()}
                focusMessageId={focusMessageId}
                onJumpToLatest={focusMessageId ? handleJumpToLatest : undefined}
              />
            )}
            <MessageComposer threadId={detail.id} botName={botName} />
          </>
        )}
      </section>
      {detail && <ConversationProfilePanel thread={detail} />}
    </div>
  )
}
