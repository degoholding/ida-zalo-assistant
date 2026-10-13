import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { MetricMappingDef } from '../types/metric'
import { MAX_METRICS } from '../utils/validate-metric-mapping'

const AGGREGATE_OPTIONS = [
  { value: 'sum', label: 'Cộng dồn' },
  { value: 'last', label: 'Lấy dòng cuối' },
] as const

interface MetricMappingMetricRowsProps {
  metrics: MetricMappingDef[]
  disabled: boolean
  onChange: (metrics: MetricMappingDef[]) => void
}

/** Danh sách chỉ tiêu của một nguồn: mã, tên, cột, đơn vị, cách gộp — thêm / xóa dòng. */
export function MetricMappingMetricRows({ metrics, disabled, onChange }: MetricMappingMetricRowsProps) {
  const update = (index: number, patch: Partial<MetricMappingDef>) =>
    onChange(metrics.map((metric, i) => (i === index ? { ...metric, ...patch } : metric)))

  return (
    <div className="space-y-2">
      {metrics.map((metric, index) => (
        <div key={index} className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 md:grid-cols-[1fr_1fr_1.2fr_5rem_9.5rem_auto]">
          <label className="space-y-1 text-xs text-muted-foreground">
            Mã chỉ tiêu
            <Input value={metric.code} disabled={disabled} placeholder="doanh_so" onChange={(e) => update(index, { code: e.target.value.trim().toLowerCase() })} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Tên hiển thị
            <Input value={metric.label} disabled={disabled} placeholder="Doanh số" onChange={(e) => update(index, { label: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Cột (tiêu đề hoặc chữ cột)
            <Input value={metric.column} disabled={disabled} placeholder="Doanh số (đ) hoặc D" onChange={(e) => update(index, { column: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Đơn vị
            <Input value={metric.unit} disabled={disabled} placeholder="đ" onChange={(e) => update(index, { unit: e.target.value })} />
          </label>
          <div className="space-y-1 text-xs text-muted-foreground">
            Cách gộp
            <Select value={metric.aggregate} disabled={disabled} onValueChange={(aggregate) => update(index, { aggregate: aggregate as MetricMappingDef['aggregate'] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="ghost" size="icon" disabled={disabled || metrics.length <= 1} aria-label="Xóa chỉ tiêu" onClick={() => onChange(metrics.filter((_, i) => i !== index))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || metrics.length >= MAX_METRICS}
        onClick={() => onChange([...metrics, { code: '', label: '', column: '', unit: '', aggregate: 'sum' }])}
      >
        <Plus />
        Thêm chỉ tiêu
      </Button>
    </div>
  )
}
