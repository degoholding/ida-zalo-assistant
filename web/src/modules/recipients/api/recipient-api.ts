import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { PaginatedResult } from '@/shared/types/api'
import type { RecipientUserOption } from '../types/recipient'

export const RECIPIENTS_API_PATH = '/api/recipients'

/** Trần `page_size` của máy chủ — số tài khoản web của một công ty còn xa con số này. */
const USER_OPTIONS_PAGE_SIZE = 200

export const recipientApi = {
  /**
   * Gửi thử một tin vào chat riêng của người nhận với bot. Lấy cả phong bì vì câu cần báo lại cho quản trị
   * («Đã xếp tin thử vào hàng gửi…») nằm ở `message`, còn `data` rỗng.
   */
  sendTest: async (id: number) => {
    const res = await httpClient.post<SuccessEnvelope<null>>(`${RECIPIENTS_API_PATH}/${id}/test`)
    return res.data.message
  },
  /** Gửi thử một bản tin / báo cáo (`kind` khớp `BriefKind` ở `src/constants.ts`) vào chat riêng với bot. */
  sendBriefTest: async (id: number, kind: number) => {
    const res = await httpClient.post<SuccessEnvelope<null>>(`${RECIPIENTS_API_PATH}/${id}/brief-test`, { kind })
    return res.data.message
  },
  listUserOptions: async () =>
    (await apiGet<PaginatedResult<RecipientUserOption>>('/api/users', { params: { page_size: USER_OPTIONS_PAGE_SIZE } })).items,
}
