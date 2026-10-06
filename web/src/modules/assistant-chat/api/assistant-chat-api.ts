import { apiGet, apiPost } from '@/core/api'
import type { AskersData, ChatMessage, SendQuestionResult } from '../types/assistant-chat'

export const ASSISTANT_CHAT_API_PATH = '/api/assistant-chat'

export const assistantChatApi = {
  askers: () => apiGet<AskersData>(`${ASSISTANT_CHAT_API_PATH}/askers`),
  messages: (contactId: number) =>
    apiGet<ChatMessage[]>(`${ASSISTANT_CHAT_API_PATH}/messages`, { params: { contact_id: contactId } }),
  /** Chờ 3-15s (gọi Gemini) — `httpClient`/axios không có timeout riêng cho tuyến này, dùng mặc định. */
  sendQuestion: (contactId: number, question: string) =>
    apiPost<SendQuestionResult>(`${ASSISTANT_CHAT_API_PATH}/messages`, { contact_id: contactId, question }),
}
