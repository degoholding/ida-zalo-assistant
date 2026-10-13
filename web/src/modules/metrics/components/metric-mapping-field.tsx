import { useController, type Control } from 'react-hook-form'

import type { CrudRecord } from '@/shared/crud/types'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type { MetricMapping } from '../types/metric'
import { createEmptyMapping, validateMetricMapping } from '../utils/validate-metric-mapping'
import { MetricMappingMetricRows } from './metric-mapping-metric-rows'

interface MetricMappingFieldProps {
  control: Control<CrudRecord>
  /** Ô của form giữ cả ánh xạ (object `MetricMapping`) */
  name: string
  disabled: boolean
}

/** Ô tự vẽ «Ánh xạ cột»: cột ngày, cột nhân viên (+ theo mã / tên), cột khu vực, danh sách chỉ tiêu. */
export function MetricMappingField({ control, name, disabled }: MetricMappingFieldProps) {
  const { field } = useController({ control, name })
  const mapping: MetricMapping = (field.value as MetricMapping | null) ?? createEmptyMapping()
  const update = (patch: Partial<MetricMapping>) => field.onChange({ ...mapping, ...patch })
  const untouched = !mapping.date && !mapping.staff && mapping.metrics.every((metric) => !metric.code && !metric.column)
  const error = untouched ? null : validateMetricMapping(mapping)

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div>
        <h3 className="text-sm font-semibold">Ánh xạ cột</h3>
        <p className="text-xs text-muted-foreground">
          Mỗi ô nhập MỘT cột của bảng: gõ đúng chữ ở dòng tiêu đề (không phân biệt hoa thường, dấu) hoặc chữ cột A…ZZ. Bấm «Kiểm tra đọc thử» để thấy bảng khớp cột nào.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Cột ngày *</Label>
          <Input value={mapping.date} disabled={disabled} placeholder="Ngày" onChange={(e) => update({ date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Cột nhân viên *</Label>
          <Input value={mapping.staff} disabled={disabled} placeholder="Nhân viên" onChange={(e) => update({ staff: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Nhân viên ghi theo</Label>
          <Select value={mapping.staff_by} disabled={disabled} onValueChange={(staff_by) => update({ staff_by: staff_by as MetricMapping['staff_by'] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Tên</SelectItem>
              <SelectItem value="code">Mã nhân viên</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Cột khu vực (không bắt buộc)</Label>
          <Input value={mapping.area} disabled={disabled} placeholder="Khu vực" onChange={(e) => update({ area: e.target.value })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Chỉ tiêu *</Label>
        <MetricMappingMetricRows metrics={mapping.metrics} disabled={disabled} onChange={(metrics) => update({ metrics })} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
