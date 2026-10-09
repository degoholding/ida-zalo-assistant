import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { taskApi, TASKS_API_PATH } from '../api/task-api'
import type { CreateTaskRequest } from '../types/task'

/** Tạo việc trên web — bot báo ngay người phụ trách qua Zalo nếu đã chọn người. */
export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: CreateTaskRequest) => taskApi.create(request),
    onSuccess: (result) => {
      toast.success(result.message || 'Đã tạo việc')
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(TASKS_API_PATH) })
    },
  })
}
