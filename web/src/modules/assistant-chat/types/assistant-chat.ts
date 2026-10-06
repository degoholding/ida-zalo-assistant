/** Một người hỏi được (vai trò Quản lý / Trưởng phòng ở Danh bạ) — `GET /api/assistant-chat/askers`. */
export interface Asker {
  id: number
  name: string
  /** Khớp `CONTACT_ROLE` ở `shared/contact-card/contact-constants.ts`: 2 = Quản lý, 1 = Trưởng phòng. */
  role: number
}

export interface AskersData {
  /** Trợ lý AI đang tắt (chưa đặt khóa Gemini) — màn phải khóa ô soạn câu hỏi. */
  assistant_on: boolean
  askers: Asker[]
}

export interface ChatMessageFile {
  attachment_id: number
  file_name: string
}

/** Một dòng trong khung chat — `GET /api/assistant-chat/messages` trả tăng dần theo giờ gửi. */
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  sent_at: string
  file: ChatMessageFile | null
}

/** `POST /api/assistant-chat/messages` — câu hỏi + câu trả lời + tệp báo cáo (nếu có) vừa tạo. */
export interface SendQuestionResult {
  status: string
  messages: ChatMessage[]
}
