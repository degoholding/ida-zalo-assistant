import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { Skeleton } from '@/shared/ui/skeleton'
import { AskerSelect } from '../components/asker-select'
import { AssistantOffBanner } from '../components/assistant-off-banner'
import { ChatComposer } from '../components/chat-composer'
import { ChatMessageList } from '../components/chat-message-list'
import { SuggestionChips } from '../components/suggestion-chips'
import { useAskers, useChatMessages, useSendQuestion } from '../hooks/use-assistant-chat'

/**
 * «Hỏi trợ lý»: hỏi trợ lý AI trong trình duyệt như nhắn Zalo cho bot — đi đúng đường thật
 * (`AssistantService`, cùng cài đặt / công cụ / giới hạn), không cần quét QR hay mở điện thoại.
 */
export function AssistantChatPage() {
  const askersQuery = useAskers()
  const askers = askersQuery.data?.askers ?? []
  const assistantOn = askersQuery.data?.assistant_on ?? false

  // Chưa ai tự chọn thì dùng người đầu danh sách — tính thẳng lúc render, không cần effect
  // (`setState` trong effect sinh thêm một vòng render chỉ để làm đúng một việc này).
  const [pickedAskerId, setPickedAskerId] = useState<number | null>(null)
  const selectedAskerId = pickedAskerId ?? askers[0]?.id ?? null

  const messagesQuery = useChatMessages(selectedAskerId)
  const sendQuestion = useSendQuestion(selectedAskerId)
  const messages = messagesQuery.data ?? []

  const inputDisabled = !assistantOn || !selectedAskerId
  const handleSend = (question: string) => sendQuestion.mutate(question)

  return (
    <PageContainer fill className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Hỏi trợ lý"
        description='Hỏi trợ lý AI như nhắn Zalo cho bot — câu trả lời đi đúng đường thật (cùng cài đặt, công cụ, giới hạn). Muốn báo cáo ra file thì nói "xuất Excel …".'
        actions={askers.length > 0 && <AskerSelect askers={askers} value={selectedAskerId} onChange={setPickedAskerId} />}
      />

      {askersQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {askersQuery.isError && (
        <ErrorState title="Không tải được danh sách người hỏi" description="Có lỗi khi gọi máy chủ, thử tải lại.">
          <Button onClick={() => void askersQuery.refetch()}>Thử lại</Button>
        </ErrorState>
      )}

      {askersQuery.isSuccess && askers.length === 0 && (
        <ErrorState
          title="Chưa có ai có vai trò"
          description="Vào Danh bạ cấp Quản lý / Trưởng phòng cho một người (hoặc chạy npm run seed:demo)."
        />
      )}

      {askersQuery.isSuccess && askers.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
          {!assistantOn && <AssistantOffBanner />}
          {messages.length === 0 && !messagesQuery.isLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center text-muted-foreground">
              <p className="text-sm">Chưa có câu hỏi nào trong cuộc này{!inputDisabled && ' — thử một gợi ý:'}</p>
              {!inputDisabled && <SuggestionChips onPick={handleSend} />}
            </div>
          ) : (
            <ChatMessageList messages={messages} isAnswering={sendQuestion.isPending} />
          )}
          <ChatComposer disabled={inputDisabled} isSending={sendQuestion.isPending} onSend={handleSend} />
        </div>
      )}
    </PageContainer>
  )
}
