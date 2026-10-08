import type { ContactRef } from '@/shared/form-pickers/contact-multi-select-field'

/** Một người nhận cảnh báo / bản tin như `GET /api/recipients` trả về. */
export interface Recipient {
  [key: string]: unknown
  id: number
  name: string
  title: string
  /** Thứ tự ưu tiên 1..20 — số nhỏ được báo trước. */
  rank_order: number
  /** Người trên Zalo bot nhắn riêng — luôn có (máy chủ bắt buộc). */
  contact_id: number
  contact_name: string | null
  /** Tài khoản web gắn với người này; `0` = không gắn. */
  user_id: number
  user_email: string | null
  all_groups: boolean
  /** `HH:MM` giờ Việt Nam, rỗng = không gửi. */
  morning_brief_at: string
  evening_brief_at: string
  notify_urgent: boolean
  is_active: boolean
  created_at: string
  group_count: number
  vip_count: number
}

/** `GET /api/recipients/:id`. */
export interface RecipientDetail extends Recipient {
  group_ids: number[]
  vip_contact_ids: number[]
  /** Người VIP kèm tên — ô «Người VIP» của biểu mẫu giữ chính mảng này. */
  vips: ContactRef[]
}

/** Mục của ô chọn «Tài khoản web» — rút từ `GET /api/users`. */
export interface RecipientUserOption {
  id: number
  email: string
  full_name: string
  is_active: boolean
}
