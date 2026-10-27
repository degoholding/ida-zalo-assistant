import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { getMetricSourceStatusLabel, METRIC_SOURCE_STATUS } from '../types/metric'

const STATUS_TONE: Record<number, StatusTone> = {
  [METRIC_SOURCE_STATUS.neverRun]: 'neutral',
  [METRIC_SOURCE_STATUS.ok]: 'done',
  [METRIC_SOURCE_STATUS.failed]: 'danger',
  [METRIC_SOURCE_STATUS.mappingError]: 'returned',
}

/** Tình trạng lượt đọc gần nhất; nguồn đã tắt thì hiện "Đã tắt" đè lên (bot không đọc nữa). */
export function MetricSourceStatusBadge({ status, isActive }: { status: number; isActive: boolean }) {
  if (!isActive) return <Pill tone="neutral">Đã tắt</Pill>
  const label = getMetricSourceStatusLabel(status)
  if (!label) return <span className="text-muted-foreground">—</span>
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{label}</Pill>
}
