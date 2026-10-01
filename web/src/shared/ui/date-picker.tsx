import { useState } from 'react'
import { CalendarIcon, X } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Calendar } from '@/shared/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { cn } from '@/shared/utils/cn'
import { formatDate, parseLocalDate, toDateInputValue } from '@/shared/utils/format-date'

interface DatePickerProps {
  /** Chuỗi `yyyy-mm-dd` (rỗng = chưa chọn) — đúng dạng API nhận và trả. */
  value: string
  /** Gọi khi chọn ngày mới hoặc xóa ngày. Xóa thì trả chuỗi rỗng. */
  onChange: (value: string) => void
  /** Gọi khi popover ĐÓNG lại — chỗ móc "lưu khi rời ô" cho các bảng nhập liệu. */
  onClose?: () => void
  disabled?: boolean
  /** `sm` = cao 32px, vừa với ô trong bảng. */
  size?: 'sm' | 'default'
  placeholder?: string
  className?: string
  /** Cho xóa ngày đã chọn bằng nút ✕ trên nút bấm. */
  clearable?: boolean
  /**
   * `id` của nút bấm, để một `<label htmlFor>` bên ngoài nối được vào.
   *
   * Cần khi ô ngày nằm trong bảng nhập liệu tự dựng nhãn (không đi qua
   * `FormLabel` của shadcn, thứ tự lo phần nối này). Thiếu nó thì nhãn hiện ra
   * bằng mắt nhưng trình đọc màn hình đọc ô đó là một nút không tên, và bấm vào
   * chữ không nhảy được vào ô.
   */
  id?: string
}

/**
 * Ô chọn ngày: nút bấm + lịch trong popover.
 *
 * Thay cho `<input type="date">` — ô ngày mặc định của trình duyệt mỗi hệ điều
 * hành một kiểu, không theo được bộ giao diện chung và trên Windows còn hiện
 * chuỗi `mm/dd/yyyy` trong khi cả hệ thống dùng `dd/mm/yyyy`.
 *
 * Giá trị vào/ra luôn là chuỗi `yyyy-mm-dd`, chỉ phần HIỂN THỊ mới là dd/mm/yyyy,
 * nên chỗ gọi không phải đổi gì so với lúc còn dùng ô ngày của trình duyệt.
 */
export function DatePicker({
  value,
  onChange,
  onClose,
  disabled,
  size = 'default',
  placeholder = 'Chọn ngày',
  className,
  clearable = true,
  id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  // `new Date('2026-08-11')` bị hiểu là giờ UTC nên ở múi giờ VN sẽ lệch về
  // ngày hôm trước — phải tự tách số rồi dựng ngày theo giờ địa phương.
  const selected = parseLocalDate(value)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) onClose?.()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start gap-2 px-2 font-normal',
            size === 'sm' && 'h-8 text-sm',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-60" />
          <span className="truncate">{selected ? formatDate(selected) : placeholder}</span>
          {clearable && selected && !disabled && (
            // `asChild` của PopoverTrigger đã biến nút này thành trigger, nên nút
            // xóa lồng bên trong phải là <span> — nút lồng trong nút là HTML sai.
            <span
              role="button"
              tabIndex={-1}
              aria-label="Xóa ngày"
              className="ml-auto rounded-sm opacity-50 hover:opacity-100"
              onPointerDown={(event) => {
                // Chặn ở pointerdown: trigger của popover mở lịch ngay từ sự kiện
                // này, để tới click thì lịch đã bung ra rồi.
                event.preventDefault()
                event.stopPropagation()
                onChange('')
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(date ? toDateInputValue(date) : '')
            setOpen(false)
            onClose?.()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
