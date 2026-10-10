import { apiGet } from '@/core/api'

export const BRIEFS_API_PATH = '/api/briefs'

/** Một mục trong ô chọn «Người nhận» của bộ lọc nâng cao — máy chủ tự giới hạn theo phạm vi người đang xem. */
export interface BriefRecipientOption {
  id: number
  name: string
}

export const briefApi = {
  searchRecipients: (search: string) =>
    apiGet<BriefRecipientOption[]>(`${BRIEFS_API_PATH}/recipients`, { params: { q: search } }),
}
