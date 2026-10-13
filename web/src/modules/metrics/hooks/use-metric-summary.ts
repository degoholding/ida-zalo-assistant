import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { metricApi } from '../api/metric-api'
import type { MetricSummaryQuery } from '../types/metric'

/** Bảng tổng hợp theo bộ lọc; chưa chọn chỉ tiêu hoặc thiếu ngày thì không gọi. */
export function useMetricSummary(query: MetricSummaryQuery) {
  return useQuery({
    queryKey: queryKeys.metrics.summary({ ...query }),
    queryFn: () => metricApi.summary(query),
    enabled: Boolean(query.metric && query.from && query.to && query.from <= query.to),
    placeholderData: keepPreviousData,
  })
}
