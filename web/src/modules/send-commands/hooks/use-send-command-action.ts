import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { sendCommandApi, SEND_COMMANDS_API_PATH } from '../api/send-command-api'
import type { SendCommandActionRequest } from '../types/send-command'

/**
 * Hủy lệnh / gửi lại nơi lỗi. Xong thì toast câu máy chủ nói. Thành công hay bị từ chối (409 — lệnh vừa đổi trạng thái, toast đỏ do
 * `http-client` bật) đều làm mới cả danh sách lẫn chi tiết (cùng gốc khóa CRUD) để nút theo đúng trạng thái mới.
 */
export function useSendCommandAction(commandId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: SendCommandActionRequest) => sendCommandApi.runAction(commandId, request),
    onSuccess: (result) => {
      toast.success(result.message || 'Đã cập nhật lệnh gửi')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(SEND_COMMANDS_API_PATH) })
    },
  })
}
