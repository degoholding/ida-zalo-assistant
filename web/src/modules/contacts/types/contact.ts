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

/** Loại dòng danh mục NV / ĐL — khớp `CatalogKind` ở `src/constants.ts`; dùng cho bộ lọc «Loại danh mục». */
export const CONTACT_CATALOG_KIND_OPTIONS = [
  { value: 1, label: 'Nhân viên' },
  { value: 2, label: 'Đại lý' },
]

/**
 * `GET /api/contacts/:id` — dòng Danh bạ cộng các mục của trang chi tiết. Các trường `catalog_*`, khu vực, vùng, người phụ
 * trách lấy qua JOIN danh mục (null khi liên hệ chưa gắn mục nào); `phone` chỉ có khi người xem đọc được danh mục.
 */
export interface ContactDetail extends Contact {
  phone?: string | null
  catalog_entry_id: number | null
  catalog_code: string | null
  catalog_kind: number | null
  region: string | null
  sales_zone: string | null
  owner_name: string | null
  groups: ContactGroup[]
  recent: ContactActivity[]
  files: ContactFile[]
  turns: ContactAssistantTurn[]
  message_total: number
}
