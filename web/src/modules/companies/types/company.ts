/** Một công ty / pháp nhân như `GET /api/companies` trả về. */
export interface Company {
  [key: string]: unknown
  id: number
  code: string
  name: string
  is_active: boolean
  created_at: string
  group_count: number
  contact_count: number
}

export interface CompanyGroup {
  id: number
  name: string
  group_kind: number
  member_count: number
  read_messages: number
  avatar_url: string | null
}

/** `GET /api/companies/:id`. */
export interface CompanyDetail extends Company {
  groups: CompanyGroup[]
}
