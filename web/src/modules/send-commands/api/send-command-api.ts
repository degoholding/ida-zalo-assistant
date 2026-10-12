import { httpClient, type SuccessEnvelope } from '@/core/api'
import type { SendCommandActionRequest, SendCommandDetail } from '../types/send-command'

export const SEND_COMMANDS_API_PATH = '/api/send-commands'

/** Lấy cả phong bì: câu máy chủ trả (vd «Đã hủy lệnh G-12.») nằm ở `message`; lỗi thì `http-client` tự bật toast đỏ. */
export const sendCommandApi = {
  runAction: async (id: number, request: SendCommandActionRequest) => {
    const res = await httpClient.post<SuccessEnvelope<SendCommandDetail>>(`${SEND_COMMANDS_API_PATH}/${id}/actions`, request)
    return { detail: res.data.data, message: res.data.message }
  },
}
