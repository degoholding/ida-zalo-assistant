import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { replyTemplateApi, REPLY_TEMPLATES_API_PATH } from '../api/reply-template-api'
import type { ReplyTemplateActionRequest } from '../types/reply-template'

/**
 * Gửi duyệt / duyệt / trả lại / ngừng dùng. Thành công hay bị từ chối (409 — mẫu vừa đổi trạng thái) đều làm mới danh sách
 * lẫn chi tiết (cùng gốc khóa CRUD) để nút và nhãn theo đúng trạng thái mới.
 */
export function useReplyTemplateAction(templateId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: ReplyTemplateActionRequest) => replyTemplateApi.runAction(templateId, request),
    onSuccess: (result) => {
      toast.success(result.message || 'Đã cập nhật mẫu tin')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(REPLY_TEMPLATES_API_PATH) })
    },
  })
}
