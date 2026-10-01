import { httpClient, type SuccessEnvelope } from '@/core/api'
import type { GroupDetail } from '../types/group'

export const GROUPS_API_PATH = '/api/groups'

/** Danh sách / chi tiết / sửa đi qua khung CRUD chung; ở đây chỉ còn việc riêng của nhóm. */
export const groupApi = {
  /** Trả cả `message` — máy chủ nói lấy được bao nhiêu tin, hoặc vì sao Zalo không trả. */
  backfill: async (id: number) => {
    const res = await httpClient.post<SuccessEnvelope<GroupDetail>>(`${GROUPS_API_PATH}/${id}/backfill`)
    return { data: res.data.data, message: res.data.message ?? 'Đã lấy tin cũ' }
  },
}
