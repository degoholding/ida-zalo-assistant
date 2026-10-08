import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { TicketActionRequest, TicketDetail, TicketHandler } from '../types/ticket'

export const TICKETS_API_PATH = '/api/tickets'
export const TICKET_HANDLERS_API_PATH = '/api/ticket-handlers'

/**
 * Lấy cả phong bì ở các lệnh ghi: câu cần báo lại cho người bấm («Nhận xử lý — đã báo qua Zalo», «Đã thêm người xử
 * lý») nằm ở `message`. Lỗi (409 «T-12 Đã xong rồi.») thì `http-client` tự bật toast đỏ đúng câu máy chủ nói.
 */
export const ticketApi = {
  runAction: async (id: number, request: TicketActionRequest) => {
    const res = await httpClient.post<SuccessEnvelope<TicketDetail>>(`${TICKETS_API_PATH}/${id}/actions`, request)
    return { detail: res.data.data, message: res.data.message }
  },
  listHandlers: () => apiGet<TicketHandler[]>(TICKET_HANDLERS_API_PATH),
  addHandler: async (contactId: number) => {
    const res = await httpClient.post<SuccessEnvelope<{ contact_id: number }>>(TICKET_HANDLERS_API_PATH, { contact_id: contactId })
    return res.data.message
  },
  removeHandler: async (contactId: number) => {
    const res = await httpClient.delete<SuccessEnvelope<{ contact_id: number }>>(`${TICKET_HANDLERS_API_PATH}/${contactId}`)
    return res.data.message
  },
}
