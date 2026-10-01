import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { useFilterContext } from '../provider/filter-context'
import type { FilterFieldDefinition } from '../types'

export interface FieldSelectProps {
  rowId: string
  selectedField: FilterFieldDefinition | null
}

/**
 * Ô chọn cột để lọc.
 *
 * Bản FilterCN gốc dùng `cmdk` (combobox có ô tìm). Ở đây đổi sang `Select`:
 * mỗi bảng chỉ khai báo dăm bảy trường lọc được, thêm hẳn một thư viện chỉ để
 * tìm trong danh sách 8 dòng là không đáng.
 */
export function FieldSelect({ rowId, selectedField }: FieldSelectProps) {
  const { config, updateField } = useFilterContext()

  return (
    <Select
      value={selectedField?.name ?? ''}
      onValueChange={(name) => {
        const field = config.fields.find((item) => item.name === name)
        if (field) updateField(rowId, field)
      }}
    >
      {/*  ⚠️ Phải `w-full`, KHÔNG dùng `flex-1`. `SelectTrigger` của shadcn mang
           sẵn `w-fit`, mà bề rộng khai tường minh thắng `align-items: stretch`
           của khối cha — nên trong cột dọc ở khổ hẹp, `flex-1` (vốn chỉ chi phối
           trục chính, tức CHIỀU CAO) không nong ô ra: ô «trường» co lại vừa chữ
           trong khi hai ô dưới trải hết hàng, ba ô so le nhau. */}
      <SelectTrigger className="w-full md:w-44 md:shrink-0">
        <SelectValue placeholder="Chọn trường…" />
      </SelectTrigger>
      <SelectContent>
        {config.fields.map((field) => (
          <SelectItem key={field.name} value={field.name}>
            {field.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
