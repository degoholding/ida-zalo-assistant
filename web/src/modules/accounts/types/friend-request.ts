/** Khớp `FriendRequestDirection` ở `src/constants.ts` của máy chủ. */
export const FRIEND_REQUEST_DIRECTION = { incoming: 1, outgoing: 2 } as const

/** Khớp `FriendRequestStatus` ở `src/constants.ts` của máy chủ. */
export const FRIEND_REQUEST_STATUS = { pending: 0, accepted: 1, rejected: 2, cancelled: 3 } as const

export const FRIEND_REQUEST_STATUS_LABELS: Record<number, string> = {
  [FRIEND_REQUEST_STATUS.pending]: 'Chờ đồng ý',
  [FRIEND_REQUEST_STATUS.accepted]: 'Đã là bạn',
  [FRIEND_REQUEST_STATUS.rejected]: 'Bị từ chối / hết hạn',
  [FRIEND_REQUEST_STATUS.cancelled]: 'Đã rút lại',
}

/** Một lời mời kết bạn (bảng friend_request). */
export interface FriendRequestRecord {
  id: number
  zalo_uid: string
  display_name: string
  avatar_url: string | null
  message: string
  direction: number
  status: number
  requested_at: string
  updated_at: string
}

/** `GET /api/accounts/:id/friends` — lời mời đến (đang chờ), lời mời đã gửi, trần mỗi ngày. */
export interface FriendOverview {
  /** Tài khoản đang chạy — tắt thì chỉ xem danh sách, không tìm / gửi / đồng ý được. */
  running: boolean
  incoming: FriendRequestRecord[]
  sent: FriendRequestRecord[]
  sent_today: number
  daily_cap: number
  default_message: string
  max_message_length: number
}

/** Quan hệ giữa bot và người vừa tra số điện thoại. */
export type FriendRelation = 'self' | 'friend' | 'requested' | 'incoming' | 'none'

/** `GET /api/accounts/:id/friends/search?phone=`. */
export interface FriendSearchResult {
  uid: string
  display_name: string
  zalo_name: string
  avatar_url: string
  relation: FriendRelation
}

export const FRIEND_RELATION_LABELS: Record<FriendRelation, string> = {
  self: 'Đây là chính tài khoản bot',
  friend: 'Đã là bạn của bot',
  requested: 'Bot đã mời, đang chờ người này đồng ý',
  incoming: 'Người này đang mời bot — đồng ý ở mục «Lời mời đến»',
  none: 'Chưa kết bạn',
}
