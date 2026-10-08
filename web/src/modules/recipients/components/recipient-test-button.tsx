import { Loader2, Send } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { useRecipientTest } from '../hooks/use-recipient-test'

/**
 * «Gửi thử» ở hàng nút dính của trang chi tiết người nhận: bot nhắn một tin vào chat riêng của người này — kiểm kênh
 * báo trước khi cảnh báo / bản tin thật chạy (người chưa từng nhắn bot thì Zalo có thể chặn).
 */
export function RecipientTestButton({ recipientId }: { recipientId: number }) {
  const sendTest = useRecipientTest()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={sendTest.isPending}
      onClick={() => sendTest.mutate(recipientId)}
    >
      {sendTest.isPending ? <Loader2 className="animate-spin" /> : <Send />}
      Gửi thử
    </Button>
  )
}
