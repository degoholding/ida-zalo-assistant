import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { recipientApi } from '../api/recipient-api'

/** «Gửi thử bản tin» (menu 4 loại cạnh «Gửi thử») — lỗi thì `http-client` tự bật toast đỏ, ở đây chỉ báo khi thành công. */
export function useRecipientBriefTest() {
  return useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: number }) => recipientApi.sendBriefTest(id, kind),
    onSuccess: (message) => {
      toast.success(message || 'Đã xếp bản tin vào hàng gửi')
    },
  })
}
