import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { scheduleApi } from '../api/schedule-api'

/** Việc chạy theo lịch (sao lưu, dọn tệp, bản tin…) — tự nạp lại mỗi phút để thấy lượt vừa chạy. */
export function useSchedules() {
  return useQuery({ queryKey: queryKeys.schedules.list(), queryFn: scheduleApi.list, refetchInterval: 60_000 })
}
