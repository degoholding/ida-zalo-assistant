/** Khớp `AttachmentStatus` ở `src/constants.ts` của máy chủ. */
export const FILE_STATUS = { pending: 0, stored: 1, failed: 2, skipped: 3, expired: 4 } as const

export const FILE_STATUS_OPTIONS = [
  { value: FILE_STATUS.pending, label: 'Đang tải' },
  { value: FILE_STATUS.stored, label: 'Đã lưu' },
  { value: FILE_STATUS.failed, label: 'Lỗi' },
  { value: FILE_STATUS.skipped, label: 'Không lấy' },
  // Quá hạn giữ tệp gốc của nhóm: tệp đã xóa khỏi kho, chữ đã bóc vẫn còn để tìm / tóm tắt
  { value: FILE_STATUS.expired, label: 'Đã xóa tệp gốc (còn chữ)' },
]

export function getFileStatusLabel(status: number): string {
  return FILE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? ''
}

/** Một tệp như `GET /api/files` trả về. */
export interface FileRecord {
  [key: string]: unknown
  id: number
  file_name: string
  file_ext: string
  status: number
  /** Đánh dấu «giữ tệp gốc»: không xóa khi hết hạn giữ tệp của nhóm. */
  keep_file: boolean
  stored_bytes: number | null
  declared_size: number | null
  size: number
  last_error: string
  attempts: number
  stored_at: string | null
  message_id: number
  sent_at: string
  sender_name: string
  sender_uid: string
  sender_avatar_url: string | null
  sender_contact_id: number | null
  zalo_msg_type: string
  message_kind: number
  thread_id: number
  thread_type: number
  thread_name: string
  download_url: string | null
  can_retry: boolean
  /** Số ký tự đã bóc; null = chưa đọc. */
  text_chars: number | null
  /** Tóm tắt ngắn của chữ đã bóc (vd «bảng 3 trang tính»); null = chưa đọc. */
  text_summary?: string | null
}

/** Khớp `MessageKind.Image` ở `src/constants.ts` của máy chủ — ảnh `chat.photo` không có tên / đuôi tệp. */
export const MESSAGE_KIND_IMAGE = 1

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

/** Tệp là ảnh (tin ảnh, hoặc đuôi ảnh) — bấm tên thì xem ảnh ngay trong hộp thoại. */
export function isImageFile(file: Pick<FileRecord, 'message_kind' | 'file_ext' | 'file_name'>): boolean {
  if (file.message_kind === MESSAGE_KIND_IMAGE) return true
  const ext = (file.file_ext || (file.file_name ?? '').split('.').pop() || '').toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

/** `GET /api/files/:id/text` — chữ đã bóc (bảng attachment_text). */
export interface FileText {
  method: string
  char_count: number
  summary: string
  text: string
  extracted_at: string
}
