import { Ban, Check, Palette } from 'lucide-react'

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/shared/ui/dropdown-menu'
import { cn } from '@/shared/utils/cn'
import { COLUMN_COLORS, findColumnColor, isCustomColor } from './column-color-palette'

interface ColumnColorMenuProps {
  /** Mã màu đang đặt cho cột; rỗng = chưa tô. */
  colorId?: string
  /** Class của nút mở menu — để đồng bộ với các nút biểu tượng cùng dòng. */
  triggerClassName?: string
  onChange: (colorId: string) => void
}

/**
 * Menu con chọn màu nền cho MỘT cột: bảng màu dựng sẵn + màu tùy chỉnh.
 * Tách khỏi `column-visibility-menu.tsx` cho file đó khỏi phình.
 */
export function ColumnColorMenu({
  colorId,
  triggerClassName,
  onChange,
}: ColumnColorMenuProps) {
  const color = findColumnColor(colorId)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        title="Tô màu cột"
        // Bỏ hết dáng "mục menu" mặc định để nút này nhìn như các nút biểu tượng
        // bên cạnh; mũi tên phụ của SubTrigger ẩn đi.
        className={cn(triggerClassName, 'px-0 py-0 [&>svg:last-child]:hidden')}
      >
        {color ? (
          <span
            className="size-4 rounded-full border"
            style={{ backgroundColor: color.value }}
          />
        ) : (
          <Palette className="size-4" />
        )}
      </DropdownMenuSubTrigger>

      <DropdownMenuSubContent className="w-44">
        <DropdownMenuItem onSelect={() => onChange('')}>
          <Ban className="text-muted-foreground" />
          Không màu
          {!color && <Check className="ml-auto size-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {COLUMN_COLORS.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => onChange(option.id)}>
            <span
              className="size-4 rounded-full border"
              style={{ backgroundColor: option.value }}
            />
            {option.label}
            {color?.id === option.id && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />

        {/* `preventDefault`: chọn màu xong menu phải Ở LẠI, đóng cái là bảng chọn
            màu của hệ điều hành cũng tắt theo. */}
        <DropdownMenuItem
          onSelect={(event) => event.preventDefault()}
          className="cursor-pointer"
          asChild
        >
          <label>
            <span
              className="size-4 rounded-full border"
              style={{
                background: isCustomColor(color?.id)
                  ? color?.value
                  : 'conic-gradient(#dc2626,#d97706,#16a34a,#0891b2,#2563eb,#7c3aed,#db2777,#dc2626)',
              }}
            />
            Màu tùy chỉnh…
            {isCustomColor(color?.id) && <Check className="ml-auto size-4" />}
            <input
              type="color"
              className="sr-only"
              value={isCustomColor(color?.id) ? color!.value : '#2563eb'}
              onChange={(event) => onChange(event.target.value)}
            />
          </label>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
