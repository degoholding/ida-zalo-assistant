import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { metricSourceApi } from '../api/metric-source-api'

/** Email của service account để quản trị chia sẻ bảng cho nó. Rỗng = chưa dán khóa ở Cài đặt → Google. */
export function useMetricServiceAccountEmail() {
  return useQuery({
    queryKey: [...queryKeys.metrics.all, 'service-account-email'] as const,
    queryFn: metricSourceApi.serviceAccountEmail,
    staleTime: 5 * 60_000,
  })
}
