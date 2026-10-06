import type { ReactNode } from 'react'

import { Label } from '@/shared/ui/label'
import { cn } from '@/shared/utils/cn'

interface SettingRowProps {
  label: string
  htmlFor?: string
  help: string
  /** Dòng nhỏ dưới giải thích: nguồn giá trị, nút khôi phục / xóa. */
  meta?: ReactNode
  /** Ô nhập / công tắc. */
  children: ReactNode
  /** Ô rộng (danh sách ô tick, ô JSON) nằm dưới phần chữ thay vì bên phải. */
  stacked?: boolean
  /** Công tắc: canh sát mép phải cho thẳng hàng. */
  alignEnd?: boolean
}

/**
 * Một hàng cài đặt kiểu bảng: nhãn + giải thích bên trái, ô nhập bên phải (màn rộng); màn hẹp thì xếp chồng.
 * Mắt lướt cột trái tìm cài đặt, cột phải đọc giá trị — không phải đọc xen kẽ chữ và ô như form một cột.
 */
export function SettingRow({ label, htmlFor, help, meta, children, stacked, alignEnd }: SettingRowProps) {
  return (
    <div className={cn('grid gap-x-8 gap-y-2.5 py-4 first:pt-1 last:pb-1', !stacked && 'md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]')}>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {help && <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-0.5">{meta}</div>}
      </div>
      <div className={cn('min-w-0 md:self-center', alignEnd && 'flex md:justify-end')}>{children}</div>
    </div>
  )
}
