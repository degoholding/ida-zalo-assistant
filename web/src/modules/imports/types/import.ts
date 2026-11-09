/** Một việc ghế (tools/sync-once.mjs đẩy vào cổng): login → sync → export → import → done | error. */
export interface SeatJob {
  stage: 'login' | 'sync' | 'export' | 'import' | 'done' | 'error'
  percent: number
  note: string | null
  error: string | null
  conversations: { done: number; total: number } | null
  files: { done: number; total: number } | null
  /** Số tệp đính kèm trong các tệp đã xuất (bot tải về sau — dung lượng thật xem bảng kết quả). */
  media: number | null
  messages: { imported: number; duplicates: number } | null
  started_at: number | null
  finished_at: number | null
  updated_at: number | null
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
    job: SeatJob | null
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
  attachments: number
  attachments_bytes: number
}
