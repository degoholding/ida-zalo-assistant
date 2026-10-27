/**
 * Chấm trạng thái kết nối ở menu (27/10/2026, đại ca chốt qua Agent 4): app Google đang ở chế độ Testing nên 7 ngày hết
 * hạn một lần; hết hạn thì việc theo dõi ghi âm họp lỗi 5 phút một lần tới khi quản trị kết nối lại. Cùng chỗ đó chấm phiên
 * Zalo của từng tài khoản bot. Tệp này thuần tính toán để kiểm được; màu + câu chữ quyết ở đây, giao diện chỉ vẽ.
 */

export type Dot = 'green' | 'red' | 'grey'

/**
 * Phần trả về của `GET /api/google/oauth/status` mà chấm trạng thái cần — khai riêng ở `shared/` cho khỏi phụ thuộc
 * `modules/settings` (cùng tên trường với `GoogleOauthStatus` bên đó).
 */
export interface GoogleHealthStatus {
  client_configured: boolean
  connected: boolean
  email: string
  /** false = app In production: không tính hạn, chỉ đỏ khi Google từ chối. */
  oauth_testing?: boolean
  days_left?: number | null
  expired?: boolean
  refresh_error?: string
  health?: 'ok' | 'expiring' | 'expired' | 'disconnected'
}

/** Phần tài khoản bot cần cho chấm trạng thái — trùng tên trường với `/api/accounts` (phần còn lại bỏ qua). */
export interface BotAccountHealth {
  id: number
  label: string
  is_active: boolean
  /** `off` / `needs_login` / `stopped` / `listening` / `reconnecting` — máy chủ gộp từ is_active + status + đang chạy. */
  state: string
  state_label: string
}

export interface GoogleDot {
  dot: Dot
  /** Dòng ngắn cạnh chấm, vd "Google: còn 3 ngày". */
  label: string
  /** Câu dài cho dải cảnh báo; rỗng = không cần cảnh báo. */
  warning: string
}

export interface ZaloDot {
  id: number
  dot: Dot
  label: string
  /** Cần quét QR lại / không chạy — lên dải cảnh báo. */
  warning: string
}

export interface ConnectionHealth {
  google: GoogleDot
  zalo: ZaloDot[]
  /** Có gì đáng lên dải cảnh báo đầu trang không. */
  warnings: string[]
}

const HOUR = 1 / 24

export function describeGoogle(status: GoogleHealthStatus | undefined): GoogleDot {
  if (!status) return { dot: 'grey', label: 'Google: đang kiểm…', warning: '' }
  if (!status.connected) {
    // Chưa dùng tính năng Google (chưa có Client ID) thì không phải lỗi; có Client ID mà chưa kết nối thì nhắc nhẹ, không báo đỏ
    return { dot: 'grey', label: status.client_configured ? 'Google: chưa kết nối' : 'Google: chưa dùng', warning: '' }
  }
  if (status.health === 'expired') {
    const why = status.refresh_error || status.oauth_testing === false ? 'Google đã từ chối kết nối' : 'đã quá 7 ngày'
    return {
      dot: 'red',
      label: 'Google: HẾT HẠN',
      warning: `Kết nối Google đã hết hạn (${why}) — ghi âm họp, lịch và Meet đang lỗi. Bấm Kết nối Google để nối lại.`,
    }
  }
  const daysLeft = status.days_left ?? null
  if (status.health === 'expiring' && daysLeft !== null) {
    const hours = Math.max(1, Math.round(daysLeft / HOUR))
    return {
      dot: 'red',
      label: `Google: hết hạn trong ${hours} giờ`,
      warning: `Kết nối Google sẽ hết hạn trong ${hours} giờ (app ở chế độ thử, 7 ngày phải kết nối lại). Bấm Kết nối Google ngay để khỏi đứt.`,
    }
  }
  if (daysLeft === null) return { dot: 'green', label: `Google: đã kết nối${status.email ? ` (${status.email})` : ''}`, warning: '' }
  return { dot: 'green', label: `Google: còn ${Math.max(1, Math.floor(daysLeft))} ngày`, warning: '' }
}

export function describeZalo(accounts: BotAccountHealth[] | undefined): ZaloDot[] {
  if (!accounts) return []
  return accounts
    .filter((account) => account.is_active)
    .map((account) => {
      const name = account.label || `Bot #${account.id}`
      if (account.state === 'listening') return { id: account.id, dot: 'green' as const, label: `${name}: đang nghe`, warning: '' }
      if (account.state === 'needs_login') {
        return { id: account.id, dot: 'red' as const, label: `${name}: cần quét QR`, warning: `Tài khoản bot ${name} hết phiên Zalo — mở Tài khoản bot quét QR lại.` }
      }
      if (account.state === 'reconnecting') return { id: account.id, dot: 'grey' as const, label: `${name}: đang nối lại`, warning: '' }
      return { id: account.id, dot: 'red' as const, label: `${name}: ${account.state_label || 'không chạy'}`, warning: `Tài khoản bot ${name} không chạy (${account.state_label || account.state}) — mở Tài khoản bot kiểm tra.` }
    })
}

export function assessConnectionHealth(status: GoogleHealthStatus | undefined, accounts: BotAccountHealth[] | undefined): ConnectionHealth {
  const google = describeGoogle(status)
  const zalo = describeZalo(accounts)
  return { google, zalo, warnings: [google.warning, ...zalo.map((item) => item.warning)].filter(Boolean) }
}
