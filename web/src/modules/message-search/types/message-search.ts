/** Một tin tìm được như `GET /api/messages/search` trả về. */
export interface MessageSearchRecord {
  [key: string]: unknown
  id: number
  thread_id: number
  thread_name: string
  thread_type: number
  sender_uid: string
  sender_name: string
  sent_at: string
  kind: number
  /** Đoạn trích quanh chỗ khớp (máy chủ cắt sẵn, «…» ở chỗ bị cắt). */
  snippet: string
}

/** Trường riêng của phản hồi `GET /api/messages/search`, ngoài `total` / `items`. */
export interface MessageSearchLimits {
  /** Máy chủ đếm tới trần (1.000) thì dừng — thật ra còn nhiều tin khớp hơn `total`. */
  total_capped?: boolean
  /** ISO. Có giá trị = từ khóa phải dò từng tin nên máy chủ chỉ tìm từ mốc này trở đi. */
  window_from?: string | null
  /** ISO. Có giá trị = máy chủ còn đang chép tin cũ vào bảng tìm, mới tìm được từ khoảng mốc này trở đi. */
  indexed_from?: string | null
}
