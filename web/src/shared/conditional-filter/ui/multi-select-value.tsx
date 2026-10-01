import { ChevronsUpDown } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import type { SelectOption } from '../types'

interface MultiSelectValueProps {
  options: SelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
}

/**
 * Ô chọn NHIỀU giá trị cho operator "thuộc danh sách" / "không thuộc danh sách".
 *
 * ⚠️ FilterCN gốc có kiểu trường `multiselect` và operator `in`/`not_in`, nhưng
 * `value-input.tsx` của nó KHÔNG có nhánh nào xử lý — người dùng rơi vào ô text
 * và phải tự gõ chuỗi ngăn cách bằng dấu phẩy. Component này bù chỗ thiếu đó.
 */
export function MultiSelectValue({
  options,
  selected,
  onChange,
}: MultiSelectValueProps) {
  const label =
    selected.length === 0
      ? 'Chọn giá trị…'
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
        : `Đã chọn ${selected.length}`

  const toggle = (value: string) =>
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-w-40 flex-1 justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-60 w-56 overflow-y-auto p-1">
        {options.length === 0 && (
          <p className="p-2 text-sm text-muted-foreground">Không có giá trị nào.</p>
        )}
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-sm transition-colors px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Checkbox
              checked={selected.includes(option.value)}
              onCheckedChange={() => toggle(option.value)}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}
