import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { AiKeyInput, AiKeyItem, AiKeyPatch } from '../types/ai-key'

/** Mọi lượt sửa trả lại cả danh sách (thứ tự mới) + câu báo của máy chủ để toast. */
async function withMessage(request: Promise<{ data: SuccessEnvelope<AiKeyItem[]> }>, fallback: string) {
  const res = await request
  return { data: res.data.data, message: res.data.message ?? fallback }
}

export const aiKeyApi = {
  list: () => apiGet<AiKeyItem[]>('/api/ai-keys'),
  /** Máy chủ gọi thử hãng rồi mới lưu — sai khóa / sai trạm thì lỗi 422 kèm câu tiếng Việt. */
  add: (body: AiKeyInput) =>
    withMessage(httpClient.post<SuccessEnvelope<AiKeyItem[]>>('/api/ai-keys', body), 'Đã lưu khóa'),
  update: (id: number, body: AiKeyPatch) =>
    withMessage(httpClient.patch<SuccessEnvelope<AiKeyItem[]>>(`/api/ai-keys/${id}`, body), 'Đã lưu khóa'),
  moveUp: (id: number) =>
    withMessage(httpClient.post<SuccessEnvelope<AiKeyItem[]>>(`/api/ai-keys/${id}/move-up`), 'Đã đổi thứ tự'),
  remove: (id: number) =>
    withMessage(httpClient.delete<SuccessEnvelope<AiKeyItem[]>>(`/api/ai-keys/${id}`), 'Đã gỡ khóa'),
}
