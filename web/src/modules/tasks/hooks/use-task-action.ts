import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { taskApi, TASKS_API_PATH } from '../api/task-api'
import type { TaskActionRequest } from '../types/task'

/**
 * Xác nhận / bỏ / xong / mở lại / hủy / dời hạn / giao lại / ghi chú. Xong thì toast câu máy chủ nói và làm mới CẢ
 * danh sách lẫn chi tiết (cùng gốc khóa `['crud', '/api/tasks']`) — trạng thái đổi thì dòng ngoài danh sách cũng
 * phải đổi theo.
 */
export function useTaskAction(taskId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: TaskActionRequest) => taskApi.runAction(taskId, request),
    onSuccess: (result) => {
      toast.success(result.message || 'Đã cập nhật việc')
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(TASKS_API_PATH) })
    },
  })
}
