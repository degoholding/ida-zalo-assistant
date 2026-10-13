import { Pill } from '@/shared/ui/pill'
import { METRIC_FLAG, METRIC_FLAG_OPTIONS } from '../types/metric'

const FLAG_TONE: Record<number, 'danger' | 'pending' | 'returned' | 'handoff'> = {
  [METRIC_FLAG.negative]: 'danger',
  [METRIC_FLAG.deviation]: 'pending',
  [METRIC_FLAG.unparsed]: 'returned',
  [METRIC_FLAG.unknownStaff]: 'handoff',
}

/** Các cờ đang bật của một dòng số liệu, mỗi cờ một nhãn; không cờ thì «—». */
export function MetricFlagChips({ flags }: { flags: number }) {
  const active = METRIC_FLAG_OPTIONS.filter((option) => (flags & option.value) !== 0)
  if (active.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((option) => (
        <Pill key={option.value} tone={FLAG_TONE[option.value]}>
          {option.label}
        </Pill>
      ))}
    </div>
  )
}
