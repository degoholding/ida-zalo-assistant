import { apiGet, apiPost, httpClient, type SuccessEnvelope } from '@/core/api'
import type { PaginatedResult } from '@/shared/types/api'
import type { MessagesCursor, MessagesPage, Thread, ThreadDetail } from '../types/conversation'

export const CONVERSATIONS_API_PATH = '/api/conversations'

/** Cột trái lấy tối đa ngần này cuộc (xếp theo tin gần nhất) — đủ cho vài trăm nhóm, không cần phân trang. */
const THREAD_LIST_SIZE = 200

export interface ThreadListParams {
  q?: string
  thread_type?: number
}

/** Đổi mốc trang sang tham số máy chủ — chỉ gửi một tham số (máy chủ ưu tiên around → after_id → before_id). */
export function toMessagesParams(cursor: MessagesCursor): Record<string, number> {
  if (cursor.around) return { around: cursor.around }
  if (cursor.afterId) return { after_id: cursor.afterId }
  if (cursor.beforeId) return { before_id: cursor.beforeId }
  return {}
}

export const conversationApi = {
  list: (params: ThreadListParams) =>
    apiGet<PaginatedResult<Thread>>(CONVERSATIONS_API_PATH, { params: { ...params, page_size: THREAD_LIST_SIZE } }),
  thread: (id: number) => apiGet<ThreadDetail>(`${CONVERSATIONS_API_PATH}/${id}`),
  messages: (id: number, cursor: MessagesCursor) =>
    apiGet<MessagesPage>(`${CONVERSATIONS_API_PATH}/${id}/messages`, { params: toMessagesParams(cursor) }),
  /** Quản trị gõ chữ — đi ra Zalo dưới tên tài khoản bot. */
  sendText: (id: number, text: string) => apiPost<{ message_id: number | null }>(`${CONVERSATIONS_API_PATH}/${id}/messages`, { text }),
  /** Tải tệp / ảnh lên rồi bot gửi: thân nhị phân thuần, tên tệp ở header (máy chủ Node không có bộ đọc multipart). */
  sendFile: async (id: number, file: File) => {
    const res = await httpClient.post<SuccessEnvelope<{ message_id: number | null }>>(`${CONVERSATIONS_API_PATH}/${id}/attachments`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    })
    return { data: res.data.data, message: res.data.message ?? 'Đã gửi tệp' }
  },
}
