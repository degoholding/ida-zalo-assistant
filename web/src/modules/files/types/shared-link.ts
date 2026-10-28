/** Khớp `SharedLinkKind` ở `src/constants.ts` của máy chủ (cột shared_link.kind). */
export const SHARED_LINK_KIND = {
  googleDriveFile: 1,
  googleSheets: 2,
  googleDocs: 3,
  googleSlides: 4,
  googleDriveFolder: 5,
  web: 9,
} as const

export const SHARED_LINK_KIND_OPTIONS = [
  { value: SHARED_LINK_KIND.googleSheets, label: 'Google Sheets' },
  { value: SHARED_LINK_KIND.googleDocs, label: 'Google Docs' },
  { value: SHARED_LINK_KIND.googleSlides, label: 'Google Slides' },
  { value: SHARED_LINK_KIND.googleDriveFile, label: 'Google Drive (tệp)' },
  { value: SHARED_LINK_KIND.googleDriveFolder, label: 'Google Drive (thư mục)' },
  { value: SHARED_LINK_KIND.web, label: 'Web khác' },
]

export function getSharedLinkKindLabel(kind: number): string {
  return SHARED_LINK_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? 'Khác'
}

/** Một link như `GET /api/files/links` trả về. */
export interface SharedLinkRecord {
  [key: string]: unknown
  id: number
  url: string
  host: string
  kind: number
  google_file_id: string | null
  /** Tiêu đề thẻ link của Zalo (nếu có) — chưa chụp tiêu đề tệp Google. */
  title: string | null
  message_id: number
  sender_uid: string
  sender_name: string
  sender_avatar_url: string | null
  sender_contact_id: number | null
  sent_at: string
  thread_id: number
  thread_type: number
  thread_name: string
}
