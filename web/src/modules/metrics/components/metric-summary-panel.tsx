import { useState } from 'react'

import { useMetricCatalog } from '../hooks/use-metric-catalog'
import { useMetricSummary } from '../hooks/use-metric-summary'
import type { MetricSummaryQuery } from '../types/metric'
import { getThisWeekRange } from '../utils/get-this-week-range'
import { MetricSummaryFilters } from './metric-summary-filters'
import { MetricSummaryTable } from './metric-summary-table'

/** Tab «Tổng hợp»: thanh lọc + bảng gộp. Mặc định tuần này, chỉ tiêu đầu tiên của danh mục. */
export function MetricSummaryPanel() {
  const { data: catalog } = useMetricCatalog()
  const [filters, setFilters] = useState<MetricSummaryQuery>(() => ({
    metric: '', ...getThisWeekRange(), area: '', staff: '', group_by: 'staff',
  }))
  const query: MetricSummaryQuery = { ...filters, metric: filters.metric || catalog?.metrics[0]?.code || '' }
  const summary = useMetricSummary(query)
  const rangeInvalid = Boolean(query.from && query.to && query.from > query.to)

  return (
    <div className="space-y-4">
      <MetricSummaryFilters query={query} catalog={catalog} onChange={(patch) => setFilters({ ...query, ...patch })} />
      {rangeInvalid && <p className="text-sm text-destructive">Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.</p>}
      {catalog && catalog.metrics.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Chưa có chỉ tiêu nào — quản trị cấu hình nguồn số liệu ở màn «Nguồn số liệu» trước.
        </p>
      ) : (
        <MetricSummaryTable summary={summary.data} groupBy={query.group_by} isLoading={summary.isLoading} isError={summary.isError || rangeInvalid} />
      )}
    </div>
  )
}
