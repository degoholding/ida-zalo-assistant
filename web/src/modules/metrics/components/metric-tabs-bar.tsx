import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { METRIC_TABS, resolveMetricTab, type MetricTabKey } from '../utils/metric-tabs'

/** Dải chọn tab của trang «Số liệu» — tab đang mở nằm ở `?tab=` trên URL (gửi link được, Lùi không mất). */
export function MetricTabsBar({ value, onChange }: { value: MetricTabKey; onChange: (tab: MetricTabKey) => void }) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(resolveMetricTab(next))}>
      <TabsList>
        {METRIC_TABS.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
