import type { ChatMessage } from '../types/assistant-chat'

/** Mã giả cho câu hỏi hiện NGAY lúc người dùng bấm gửi, trước khi máy chủ trả lời (3-15s). */
export const OPTIMISTIC_MESSAGE_ID = -1

/** Bong bóng câu hỏi hiện tạm trong lúc chờ trợ lý trả lời — bị `mergeChatMessages` bỏ khi tin thật về. */
export function createOptimisticQuestion(text: string, sentAt: string = new Date().toISOString()): ChatMessage {
  return { id: OPTIMISTIC_MESSAGE_ID, role: 'user', text, sent_at: sentAt, file: null }
}

/**
 * Nối tin mới (câu trả lời của `POST /api/assistant-chat/messages`, gồm cả câu hỏi
 * thật) vào danh sách đang hiện: bỏ bong bóng tạm (`OPTIMISTIC_MESSAGE_ID`), rồi chỉ
 * thêm tin có `id` CHƯA có trong danh sách — gọi lại (vd lỗi mạng rồi thử lại) không
 * nhân đôi dòng chat.
 */
export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const withoutOptimistic = current.filter((message) => message.id !== OPTIMISTIC_MESSAGE_ID)
  const seenIds = new Set(withoutOptimistic.map((message) => message.id))
  const merged = [...withoutOptimistic]
  for (const message of incoming) {
    if (seenIds.has(message.id)) continue
    seenIds.add(message.id)
    merged.push(message)
  }
  return merged
}
