import { apiGet } from '@/core/api'
import type { Contact } from '@/shared/contact-card/contact-constants'
import { CONTACTS_API_PATH } from '@/shared/contact-card/contact-card-api'
import type { PaginatedResult } from '@/shared/types/api'

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

/** Số người trả về mỗi lần tra — đủ để chọn, ai không thấy thì gõ thêm chữ. */
const CONTACT_SEARCH_PAGE_SIZE = 30

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
  /** Tra người trong Danh bạ theo tên / mã Zalo / ghi chú — cho ô chọn người (Danh bạ có thể hàng nghìn người). */
  searchContacts: (keyword: string) =>
    apiGet<PaginatedResult<Contact>>(CONTACTS_API_PATH, {
      params: { q: keyword.trim() || undefined, page_size: CONTACT_SEARCH_PAGE_SIZE },
    }),
  contact: (id: number) => apiGet<Contact>(`${CONTACTS_API_PATH}/${id}`),
}
