import type { PermissionMap } from '@/core/authorization/permission-types'
import type { UserRole } from './user-role'

/** Hồ sơ người đang đăng nhập do `/api/auth/login|google|me` trả về. */
export interface AuthUser {
  /** 0 = phiên đăng nhập bằng mật khẩu quản trị (không gắn với dòng người dùng nào). */
  id: number
  full_name: string
  /** Rỗng với phiên mật khẩu quản trị. */
  email: string
  role: UserRole
  /** Thấy mọi nhóm — quản trị luôn `true`; còn lại theo ô «Thấy mọi nhóm» ở màn Người dùng. */
  all_groups: boolean
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

/** `GET /api/auth/config` — đọc được khi CHƯA đăng nhập. */
export interface AuthConfig {
  /** Client ID OAuth của nút «Đăng nhập bằng Google»; rỗng = máy chủ chưa bật đăng nhập Google. */
  google_client_id: string
}
