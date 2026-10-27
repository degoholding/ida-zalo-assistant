import { httpClient, type SuccessEnvelope } from '@/core/api'
import type { ReplyTemplate, ReplyTemplateActionRequest } from '../types/reply-template'

export const REPLY_TEMPLATES_API_PATH = '/api/reply-templates'

/** Lấy cả phong bì: câu máy chủ báo ("Đã duyệt mẫu"…) nằm ở `message`; lỗi 403 / 409 / 422 thì `http-client` tự bật toast đỏ. */
export const replyTemplateApi = {
  runAction: async (id: number, request: ReplyTemplateActionRequest) => {
    const res = await httpClient.post<SuccessEnvelope<ReplyTemplate>>(`${REPLY_TEMPLATES_API_PATH}/${id}/actions`, request)
    return { detail: res.data.data, message: res.data.message }
  },
}
