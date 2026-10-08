import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { recipientApi } from '../api/recipient-api'

/** «Gửi thử» kênh báo của một người nhận. Lỗi thì `http-client` tự bật toast đỏ, ở đây chỉ báo khi thành công. */
export function useRecipientTest() {
  return useMutation({
    mutationFn: (id: number) => recipientApi.sendTest(id),
    onSuccess: (message) => {
      toast.success(message || 'Đã xếp tin thử vào hàng gửi')
    },
  })
}
