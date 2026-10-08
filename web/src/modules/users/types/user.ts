/** Một người dùng web như `GET /api/users` trả về (khác `AuthUser` — hồ sơ của người ĐANG đăng nhập). */
export interface AppUser {
  [key: string]: unknown
  id: number
  /** Rỗng = không đăng nhập Google được */
  email: string
  /** Rỗng = chỉ đăng nhập bằng email / nút Google */
  username: string
  /** Đã đặt mật khẩu chưa — máy chủ không bao giờ trả mật khẩu */
  has_password: boolean
  full_name: string
  /** `USER_ROLE` ở `@/core/auth/user-role`. */
  role: number
  /** Người này trên Zalo (Danh bạ); `0` = chưa gắn. */
  contact_id: number
  contact_name: string | null
  all_groups: boolean
  is_active: boolean
  last_login_at: string | null
  created_at: string
  /** Số nhóm trong phạm vi được xem (chỉ có nghĩa khi không «Thấy mọi nhóm»). */
  group_count: number
}

/** `GET /api/users/:id`. */
export interface AppUserDetail extends AppUser {
  group_ids: number[]
}
