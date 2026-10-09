import { httpClient, type SuccessEnvelope } from '@/core/api'
import type { CreateTaskRequest, TaskActionRequest, TaskDetail } from '../types/task'

export const TASKS_API_PATH = '/api/tasks'

/**
 * Lấy cả phong bì: câu cần báo lại cho người bấm («Đã tạo việc», «Dời hạn … — đã báo qua Zalo») nằm ở `message`.
 * Lỗi (409 «V-12 vừa được cập nhật…») thì `http-client` tự bật toast đỏ đúng câu máy chủ nói.
 */
export const taskApi = {
  create: async (request: CreateTaskRequest) => {
    const res = await httpClient.post<SuccessEnvelope<TaskDetail>>(TASKS_API_PATH, request)
    return { detail: res.data.data, message: res.data.message }
  },
  runAction: async (id: number, request: TaskActionRequest) => {
    const res = await httpClient.post<SuccessEnvelope<TaskDetail>>(`${TASKS_API_PATH}/${id}/actions`, request)
    return { detail: res.data.data, message: res.data.message }
  },
}
