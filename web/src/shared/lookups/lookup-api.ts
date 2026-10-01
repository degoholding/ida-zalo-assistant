import { apiGet } from '@/core/api'

/** Mục trong ô chọn / bộ lọc — khớp `src/web/api/lookups-api.ts` của máy chủ. */
export interface LookupItem {
  id: number
  name: string
}

export interface CompanyLookupItem extends LookupItem {
  code: string
  is_active: boolean
}

export interface ThreadLookupItem extends LookupItem {
  thread_type: number
}

/** Đường API của các danh sách ngắn (cho `source.url` của ô chọn trong biểu mẫu CRUD). */
export const LOOKUP_URLS = {
  /** Có mục «— Chưa gán —» (id 0) ở đầu — cho ô chọn công ty của biểu mẫu. */
  companiesWithNone: '/api/lookups/companies?with_none=1',
  companies: '/api/lookups/companies',
  groups: '/api/lookups/groups',
  threads: '/api/lookups/threads',
  contactTags: '/api/lookups/contact-tags',
}

export const lookupApi = {
  companies: (withNone: boolean) => apiGet<CompanyLookupItem[]>(withNone ? LOOKUP_URLS.companiesWithNone : LOOKUP_URLS.companies),
  groups: () => apiGet<LookupItem[]>(LOOKUP_URLS.groups),
  threads: () => apiGet<ThreadLookupItem[]>(LOOKUP_URLS.threads),
  contactTags: () => apiGet<string[]>(LOOKUP_URLS.contactTags),
}
