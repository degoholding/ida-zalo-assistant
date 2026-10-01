import type { PermissionMap } from '@/core/authorization/permission-types'

/** Hồ sơ người đang đăng nhập do `/api/auth/login|me` trả về. */
export interface AuthUser {
  id: number
  full_name: string
  /** Ma trận quyền `{ thực thể: { hành động: true } }` — chỉ để ẩn/hiện nút, chốt thật ở máy chủ. */
  permissions: PermissionMap
  /** Tùy chọn giao diện lưu phía máy chủ (bảng màu…) — khung theme của ERP đọc ô này. */
  preferences?: Record<string, string>
}

export interface LoginResponse {
  user: AuthUser
}

export interface LoginCredentials {
  password: string
}
