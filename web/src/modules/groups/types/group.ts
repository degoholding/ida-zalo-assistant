/** Một nhóm Zalo như `GET /api/groups` trả về. */
export interface Group {
  [key: string]: unknown
  id: number
  zalo_group_id: string
  name: string
  label: string
  group_kind: number
  /** 0 = chưa gán công ty. */
  company_id: number
  company_name: string | null
  member_count: number
  read_messages: boolean
  capture_files: boolean
  retention_days: number
  first_seen_at: string
  members_synced_at: string | null
  avatar_url: string | null
  bot_count: number
  message_count: number
  file_count: number
  last_message_at: string | null
}

export interface GroupMember {
  zalo_uid: string
  contact_id: number | null
  name: string
  kind: number
  role: number
  is_admin: boolean
  is_bot: boolean
  first_seen_at: string
  left_at: string | null
  avatar_url: string | null
  direct_thread_id: number | null
}

export interface GroupBot {
  id: number
  label: string
  display_name: string
  joined_at: string
  left_at: string | null
}

/** `GET /api/groups/:id`. */
export interface GroupDetail extends Group {
  members: GroupMember[]
  bots: GroupBot[]
}

/** `POST/GET /api/groups/:id/backfill` — việc lấy tin cũ chạy nền. */
export interface BackfillStatus {
  group_id: number
  running: boolean
  full: boolean
  pages: number
  fetched: number
  stored: number
  oldest: string | null
  started_at: string
  finished_at: string | null
  error: string
  message: string
}
