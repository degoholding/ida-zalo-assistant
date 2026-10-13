import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { metricApi } from '../api/metric-api'

/** Chỉ tiêu + khu vực + nhân viên cho các ô lọc. Khóa nằm dưới gốc `queryKeys.metrics.all` để làm mới cùng lúc. */
export function useMetricCatalog() {
  return useQuery({
    queryKey: [...queryKeys.metrics.all, 'catalog'] as const,
    queryFn: metricApi.catalog,
    staleTime: 60_000,
  })
}
