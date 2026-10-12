import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { botHaltApi } from './bot-halt-api'

const POLL_INTERVAL_MS = 30_000

/**
 * Tình trạng tắt bot khẩn cho MỌI người đăng nhập — dải đỏ ở khung trang đọc 30 giây / lần (người khác bấm Tắt thì
 * tối đa 30 giây sau dải hiện). Lỗi mạng thì giữ giá trị cũ, không nhá dải sai.
 */
export function useBotHaltStatus() {
  return useQuery({
    queryKey: queryKeys.botHalt.status(),
    queryFn: botHaltApi.getStatus,
    refetchInterval: POLL_INTERVAL_MS,
  })
}
