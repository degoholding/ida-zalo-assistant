import { DatePicker } from '@/shared/ui/date-picker'
import { Label } from '@/shared/ui/label'
import { SearchSelect } from '@/shared/ui/search-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { METRIC_GROUP_BY_OPTIONS, type MetricCatalog, type MetricGroupBy, type MetricSummaryQuery } from '../types/metric'

const ALL = '__all__'

interface MetricSummaryFiltersProps {
  query: MetricSummaryQuery
  catalog: MetricCatalog | undefined
  onChange: (patch: Partial<MetricSummaryQuery>) => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-40 flex-1 space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

/** Thanh lọc tab "Tổng hợp": chỉ tiêu, khoảng ngày, khu vực, nhân viên, gộp theo. */
export function MetricSummaryFilters({ query, catalog, onChange }: MetricSummaryFiltersProps) {
  // Cùng một mã có thể do nhiều nguồn khai — ô chọn chỉ cần một dòng cho mỗi mã
  const metrics = [...new Map((catalog?.metrics ?? []).map((item) => [item.code, item])).values()]
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Chỉ tiêu">
        <Select value={query.metric || undefined} onValueChange={(metric) => onChange({ metric })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Chọn chỉ tiêu" />
          </SelectTrigger>
          <SelectContent>
            {metrics.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.label}
                {item.unit ? ` (${item.unit})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Từ ngày">
        <DatePicker value={query.from} onChange={(from) => onChange({ from })} />
      </Field>
      <Field label="Đến ngày">
        <DatePicker value={query.to} onChange={(to) => onChange({ to })} />
      </Field>
      <Field label="Khu vực">
        <Select value={query.area || ALL} onValueChange={(area) => onChange({ area: area === ALL ? '' : area })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả khu vực</SelectItem>
            {(catalog?.areas ?? []).map((area) => (
              <SelectItem key={area.key} value={area.key}>
                {area.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Nhân viên">
        <SearchSelect
          value={query.staff}
          onChange={(staff) => onChange({ staff })}
          options={(catalog?.staff ?? []).map((person) => ({ value: String(person.id), label: person.region ? `${person.name} · ${person.region}` : person.name }))}
          clearable
          placeholder="Tất cả nhân viên"
          searchPlaceholder="Gõ tên nhân viên"
          emptyMessage="Không có nhân viên nào khớp — danh mục nhân viên nạp ở màn Danh mục."
        />
      </Field>
      <Field label="Gộp theo">
        <Select value={query.group_by} onValueChange={(group_by) => onChange({ group_by: group_by as MetricGroupBy })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRIC_GROUP_BY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}
