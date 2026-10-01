import { apiGet, apiPatch } from '@/core/api'
import type { Contact, ContactPatch } from './contact-constants'

export const CONTACTS_API_PATH = '/api/contacts'

/** Thẻ nổi + sửa nhanh hồ sơ — dùng từ nhiều phân hệ nên nằm ở `shared/`. */
export const contactCardApi = {
  card: (uid: string) => apiGet<Contact>(`/api/contact-cards/${encodeURIComponent(uid)}`),
  update: (id: number, patch: ContactPatch) => apiPatch<Contact>(`${CONTACTS_API_PATH}/${id}`, patch),
}
