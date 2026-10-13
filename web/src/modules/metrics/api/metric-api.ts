import { apiGet } from '@/core/api'
import type { MetricCatalog, MetricMissing, MetricSummary, MetricSummaryQuery } from '../types/metric'

export const METRICS_API_PATH = '/api/metrics'
export const METRIC_VALUES_API_PATH = `${METRICS_API_PATH}/values`

export const metricApi = {
  catalog: () => apiGet<MetricCatalog>(`${METRICS_API_PATH}/catalog`),
  summary: (query: MetricSummaryQuery) =>
    apiGet<MetricSummary>(`${METRICS_API_PATH}/summary`, {
      params: { ...query, area: query.area || undefined, staff: query.staff || undefined },
    }),
  missing: (date: string) => apiGet<MetricMissing>(`${METRICS_API_PATH}/missing`, { params: { date } }),
}
