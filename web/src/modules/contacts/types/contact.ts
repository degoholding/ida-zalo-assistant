import type { Contact } from '@/shared/contact-card/contact-constants'

export interface ContactGroup {
  id: number
  name: string
  group_kind: number
  is_admin: number
  member_count: number
  left_at: string | null
  avatar_url: string | null
}

export interface ContactActivity {
  id: number
  thread_id: number
  thread_type: number
  thread_name: string
  text: string | null
  file_name: string | null
  sent_at: string
}

export interface ContactFile {
  id: number
  file_name: string
  thread_name: string
  sent_at: string
  stored_bytes: number | null
  status: number
}

export interface ContactAssistantTurn {
  id: number
  created_at: string
  status: number
  question: string | null
  input_tokens: number
  output_tokens: number
}

/** `GET /api/contacts/:id` — dòng Danh bạ cộng các mục của trang chi tiết. */
export interface ContactDetail extends Contact {
  groups: ContactGroup[]
  recent: ContactActivity[]
  files: ContactFile[]
  turns: ContactAssistantTurn[]
  message_total: number
}
