import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { queryKeys } from '@/shared/constants/query-keys'
import { metricSourceApi, METRIC_SOURCES_API_PATH, type MetricSourceAction } from '../api/metric-source-api'

const ACTION_DONE: Record<MetricSourceAction, string> = {
  enable: 'Đã bật đọc nguồn',
  disable: 'Đã tắt đọc nguồn',
  sync_now: 'Đã đọc xong',
}

/**
 * Bật / Tắt / "Đọc ngay" một nguồn. Lỗi (Google từ chối, ánh xạ sai, nguồn đang được đọc) do `http-client` toast đỏ; dù thành công hay
 * lỗi đều làm mới chi tiết + danh sách nguồn (trạng thái lượt đọc đổi) và số liệu (sau khi đọc có số mới).
 */
export function useMetricSourceAction(sourceId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: MetricSourceAction) => metricSourceApi.runAction(sourceId, action),
    onSuccess: (_result, action) => {
      toast.success(ACTION_DONE[action])
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(METRIC_SOURCES_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.metrics.all })
    },
  })
}
