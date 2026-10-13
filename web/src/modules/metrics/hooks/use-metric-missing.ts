import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/shared/constants/query-keys'
import { metricApi } from '../api/metric-api'

/** Ai chưa báo / báo muộn trong một ngày. */
export function useMetricMissing(date: string) {
  return useQuery({
    queryKey: [...queryKeys.metrics.all, 'missing', date] as const,
    queryFn: () => metricApi.missing(date),
    enabled: Boolean(date),
  })
}
