import { useSearchParams } from 'react-router-dom'

import { CrudListPage } from '@/shared/crud/crud-list-page'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { MetricMissingPanel } from '../components/metric-missing-panel'
import { MetricSummaryPanel } from '../components/metric-summary-panel'
import { MetricTabsBar } from '../components/metric-tabs-bar'
import { metricValueCrudConfig } from '../config/metric-value-crud'
import { resolveMetricTab, type MetricTabKey } from '../utils/metric-tabs'

/** Màn "Số liệu" (Quản trị + Quản lý): tab Tổng hợp / Chi tiết / Chưa báo. Tab "Chi tiết" là `CrudListPage` thật (lọc ngày, cờ, sắp xếp). */
export function MetricsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = resolveMetricTab(searchParams.get('tab'))
  // Đổi tab thì bỏ bộ lọc / trang của tab cũ — chỉ giữ `tab`
  const changeTab = (next: MetricTabKey) => setSearchParams(next === 'summary' ? {} : { tab: next }, { replace: true })
  const tabs = <MetricTabsBar value={tab} onChange={changeTab} />

  if (tab === 'details') return <CrudListPage config={metricValueCrudConfig} beforeContent={tabs} />

  return (
    <PageContainer>
      <PageHeader title="Số liệu" description="Số liệu bot đọc từ các bảng Google Sheets: tổng hợp theo nhân viên / khu vực / ngày, chi tiết từng dòng và ai chưa báo." />
      <div className="mb-4">{tabs}</div>
      {tab === 'missing' ? <MetricMissingPanel /> : <MetricSummaryPanel />}
    </PageContainer>
  )
}
