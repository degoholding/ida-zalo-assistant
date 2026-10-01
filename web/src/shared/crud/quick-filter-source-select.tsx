import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useCrudSourceOptions } from './use-crud'

interface QuickFilterSourceSelectProps {
  label: string
  sourceUrl: string
  value: string
  onChange: (value: string) => void
}

/** Ô lọc nhanh nạp mục từ API (`QuickFilterConfig.sourceUrl`) — vd lọc Nhóm theo công ty. */
export function QuickFilterSourceSelect({ label, sourceUrl, value, onChange }: QuickFilterSourceSelectProps) {
  const { data: options, isLoading } = useCrudSourceOptions({ url: sourceUrl })
  return (
    <Select value={value} onValueChange={onChange} disabled={isLoading}>
      <SelectTrigger className="h-9 w-full text-xs md:w-40" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả {label.toLowerCase()}</SelectItem>
        {(options ?? []).map((opt) => (
          <SelectItem key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
