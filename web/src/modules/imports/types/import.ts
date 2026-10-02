/** `POST /api/imports/zalo-web` — kết quả nạp một tệp xuất từ Zalo Web. */
export interface ImportSummary {
  total: number
  imported: number
  duplicates: number
  enriched: number
  skipped_direct: number
  skipped_unknown_group: number
  skipped_group_not_read: number
  oldest: string | null
  newest: string | null
  groups: { zalo_group_id: string; name: string; imported: number }[]
}

/** `GET /api/imports/zalo-web/targets` — nhóm bot đang đọc, bookmarklet «tất cả nhóm» ghé lần lượt. */
export interface ExportTarget {
  /** Mã nhóm Zalo, không có tiền tố "g". */
  id: string
  name: string
}

/** Kết quả nạp nhiều tệp một lượt: cộng gộp các tệp thành công + danh sách tệp lỗi. */
export interface BatchImportResult {
  summary: ImportSummary | null
  files: number
  failures: { fileName: string; message: string }[]
}
