/** `POST /api/imports/zalo-web` — kết quả nạp một tệp xuất từ Zalo Web. */
export interface ImportSummary {
  total: number
  imported: number
  duplicates: number
  enriched: number
  skipped_direct: number
  skipped_unknown_group: number
  skipped_group_not_read: number
  /** Tệp chat riêng của tài khoản Zalo chưa gắn vào bot (phase 14.5) — bỏ cả tệp. */
  skipped_unknown_account?: number
  /** Tệp là chat riêng (true) hay nhóm. */
  direct?: boolean
  oldest: string | null
  newest: string | null
  groups: { zalo_group_id: string; name: string; imported: number }[]
}

/** `GET /api/imports/zalo-web/targets` — nhóm bot đang đọc, bookmarklet "tất cả nhóm" ghé lần lượt. */
export interface ExportTarget {
  /** Mã nhóm Zalo, không có tiền tố "g". */
  id: string
  name: string
}

/** `?files=` của `POST /api/imports/zalo-web` — tệp đính kèm của tin nhập (phase 14.8). */
export type ImportFilesMode = 'none' | 'images_pdf' | 'all'

export const IMPORT_FILES_MODE_LABELS: Record<ImportFilesMode, string> = {
  none: 'Không lấy tệp (chỉ chữ + tên tệp)',
  images_pdf: 'Ảnh + PDF (mặc định)',
  all: 'Mọi tệp',
}

/** `GET /api/imports/seat` — trạng thái ghế đồng bộ Zalo PC (phase 14.6). */
export interface SeatInfo {
  configured: boolean
  reachable: boolean
  error?: string
  status?: {
    phase: string
    user: { userId: string; displayName: string } | null
    linked_account: string | null
    conversations: number
    last_qr_at: number
    sync: { ready: boolean; running: boolean; progress: number | null; last_result: string | null; started_at: number | null; finished_at: number | null } | null
  }
}

/** `GET /api/imports/results` — một dòng mỗi cuộc từng được nhập tin cũ. */
export interface ImportResultRow {
  group_id: number
  thread_type: number
  zalo_thread_id: string
  name: string
  read_messages: boolean
  messages: number
  oldest: string | null
  newest: string | null
  last_import_at: string | null
  imports: number
}

/** Kết quả nạp nhiều tệp một lượt: cộng gộp các tệp thành công + danh sách tệp lỗi. */
export interface BatchImportResult {
  summary: ImportSummary | null
  files: number
  failures: { fileName: string; message: string }[]
}
