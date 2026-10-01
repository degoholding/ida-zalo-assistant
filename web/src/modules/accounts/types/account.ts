/** Một tài khoản bot như `GET /api/accounts` trả về. */
export interface BotAccount {
  [key: string]: unknown
  id: number
  label: string
  zalo_uid: string | null
  display_name: string
  status: number
  is_active: boolean
  running: boolean
  /** Trạng thái gộp do máy chủ tính: off | needs_login | stopped | listening | reconnecting. */
  state: string
  state_label: string
  avatar_url: string | null
  last_connected_at: string | null
  last_heartbeat_at: string | null
  created_at: string
  group_count: number
  direct_count: number
}

export interface AccountGroup {
  id: number
  name: string
  member_count: number
  read_messages: number
  joined_at: string
  left_at: string | null
  avatar_url: string | null
}

export interface SessionEventRecord {
  id: number
  event: number
  code: number | null
  detail: string
  created_at: string
}

/** `GET /api/accounts/:id`. */
export interface BotAccountDetail extends BotAccount {
  groups: AccountGroup[]
  events: SessionEventRecord[]
}

/** Khớp `SessionEvent` ở `src/constants.ts` của máy chủ. */
export const SESSION_EVENT_LABELS: Record<number, string> = {
  0: 'Đăng nhập bằng phiên đã lưu',
  1: 'Phiên đã lưu không còn dùng được',
  2: 'Đăng nhập QR thành công',
  3: 'Đã kết nối',
  4: 'Mất kết nối',
  5: 'Zalo đóng kết nối',
  6: 'Lỗi',
  7: 'Dừng',
}

export type QrLoginPhase = 'starting' | 'waiting_scan' | 'scanned' | 'success' | 'failed'

/** Trạng thái một lượt đăng nhập QR — `POST/GET /api/accounts/qr-login`. */
export interface QrLoginState {
  id: string
  label: string
  phase: QrLoginPhase
  message: string
  qr_image: string
}
