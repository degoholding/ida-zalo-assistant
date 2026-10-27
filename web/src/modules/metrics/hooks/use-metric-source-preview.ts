import { useMutation } from '@tanstack/react-query'

import { metricSourceApi, type MetricPreviewRequest } from '../api/metric-source-api'

/** "Kiểm tra đọc thử" — dùng cấu hình ĐANG GÕ, máy chủ không ghi gì. */
export function useMetricSourcePreview() {
  return useMutation({ mutationFn: (request: MetricPreviewRequest) => metricSourceApi.preview(request) })
}
