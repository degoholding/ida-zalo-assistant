/**
 * Bộ mã số của người trong Danh bạ — khớp `src/constants.ts` của máy chủ; đổi bên đó thì sửa tay bên này.
 * Nằm ở `shared/` vì nhiều phân hệ cùng hiển thị người (Danh bạ, Nhóm, Tệp, Hội thoại).
 */
export const CONTACT_KIND = { unclassified: 0, customer: 1, staff: 2 } as const
export const CONTACT_KIND_SOURCE = { auto: 0, manual: 1 } as const
export const CONTACT_ROLE = { none: 0, departmentHead: 1, manager: 2 } as const
export const GROUP_KIND = { customer: 1, internal: 2 } as const
export const CONVERSATION_TYPE = { direct: 0, group: 1 } as const

/** Ô «Loại» của biểu mẫu: `auto` = theo nhóm, còn lại là mã loại chỉnh tay (máy chủ: `kind_mode`). */
export const KIND_MODE_AUTO = 'auto'

export const CONTACT_KIND_OPTIONS = [
  { value: CONTACT_KIND.unclassified, label: 'Chưa phân loại' },
  { value: CONTACT_KIND.customer, label: 'Khách hàng' },
  { value: CONTACT_KIND.staff, label: 'Nhân sự' },
]

export const CONTACT_ROLE_OPTIONS = [
  { value: CONTACT_ROLE.none, label: 'Không — chỉ lưu' },
  { value: CONTACT_ROLE.departmentHead, label: 'Trưởng phòng' },
  { value: CONTACT_ROLE.manager, label: 'Quản lý' },
]

export const GROUP_KIND_OPTIONS = [
  { value: GROUP_KIND.customer, label: 'Khách hàng' },
  { value: GROUP_KIND.internal, label: 'Nội bộ' },
]

/** Một người như `GET /api/contacts` / `GET /api/contact-cards/:uid` trả về. */
export interface Contact {
  [key: string]: unknown
  id: number
  zalo_uid: string
  global_id: string | null
  display_name: string
  zalo_name: string
  avatar_url: string | null
  kind: number
  kind_source: number
  /** `auto` hoặc mã loại dạng chuỗi — giá trị của ô chọn «Loại». */
  kind_mode: string
  role: number
  /** 0 = chưa gán (ô chọn không biểu diễn được null). */
  company_id: number
  company_name: string | null
  note: string | null
  first_seen_at: string
  last_dm_at: string | null
  dm_count: number
  group_count: number
  direct_thread_id: number | null
  tags: string[]
  is_bot: boolean
}

/** Thân `PATCH /api/contacts/:id`. */
export interface ContactPatch {
  kind_mode?: string
  role?: number
  company_id?: number
  note?: string
  tags?: string[]
}
