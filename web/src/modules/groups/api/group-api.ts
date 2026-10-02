import { apiGet, apiPost } from '@/core/api'
import type { BackfillStatus } from '../types/group'

export const GROUPS_API_PATH = '/api/groups'

/** Danh sách / chi tiết / sửa đi qua khung CRUD chung; ở đây chỉ còn việc riêng của nhóm. */
export const groupApi = {
  /** Bắt đầu lấy tin cũ ở nền (`full` = kéo toàn bộ lịch sử). */
  startBackfill: (id: number, full = true) => apiPost<BackfillStatus>(`${GROUPS_API_PATH}/${id}/backfill`, { full }),
  backfillStatus: (id: number) => apiGet<BackfillStatus>(`${GROUPS_API_PATH}/${id}/backfill`),
}
