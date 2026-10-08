import type { Contact } from '@/shared/contact-card/contact-constants'

/** Một cuộc trò chuyện trong cột trái — `GET /api/conversations`. */
export interface Thread {
  id: number
  thread_type: number
  name: string
  label: string
  display_name: string
  zalo_group_id: string
  company_id: number | null
  message_count: number
  last_message_at: string | null
  last_text: string | null
  last_sender: string | null
  last_from_bot: boolean
  avatar_url: string | null
}

export interface ThreadMember {
  zalo_uid: string
  contact_id: number | null
  name: string
  kind: number
  role: number
  is_admin: boolean
  is_bot: boolean
  left_at: string | null
  avatar_url: string | null
  direct_thread_id: number | null
}

export interface ThreadGroup {
  id: number
  name: string
  label: string
  zalo_group_id: string
  group_kind: number
  member_count: number
  read_messages: number
  capture_files: number
  retention_days: number
  company_id: number | null
  company_name: string | null
  avatar_url: string | null
  members: ThreadMember[]
}

/** `GET /api/conversations/:id` — đầu cuộc + hồ sơ cột phải. */
export interface ThreadDetail extends Thread {
  /** Tên tài khoản bot sẽ đứng tên tin quản trị gõ (null = không có bot nào gửi được). */
  bot_name: string | null
  contact: Contact | null
  group: ThreadGroup | null
}

export interface MessageAttachment {
  id: number
  file_name: string
  file_ext: string
  status: number
  size: number
  download_url: string | null
}

/** Khớp `MessageKind` ở `src/constants.ts` của máy chủ. */
export const MESSAGE_KIND = { text: 0, image: 1, file: 2, video: 3, voice: 4, sticker: 5, link: 6, location: 7, contact: 8, system: 9, other: 99 } as const

export interface ChatMessage {
  id: number
  sender_uid: string
  sender_name: string
  sender_contact_id: number | null
  sender_avatar_url: string | null
  sent_at: string
  text: string | null
  kind: number
  zalo_msg_type: string
  quote_text: string | null
  recalled_at: string | null
  from_bot: boolean
  /** Quản trị gõ tay từ web (vẫn đi ra dưới tên bot), khác AI tự trả lời. */
  from_admin: boolean
  attachment: MessageAttachment | null
}

/** `GET /api/conversations/:id/messages` — một trang, xếp theo giờ gửi tăng dần. */
export interface MessagesPage {
  items: ChatMessage[]
  /** Id tin cũ nhất trang khi còn tin cũ hơn (`before_id=`); null = hết. */
  older_cursor: number | null
  /** Id tin mới nhất trang khi còn tin mới hơn (`after_id=`) — chỉ có khi đang xem quanh một tin cũ; null = tới tin mới nhất. */
  newer_cursor: number | null
}

/** Trang cần lấy: mới nhất (rỗng), cũ hơn / mới hơn một tin, hoặc quanh một tin (`?msg=` trên URL). */
export interface MessagesCursor {
  beforeId?: number
  afterId?: number
  around?: number
}
