import type { ReactNode } from 'react'

import { TableHead } from '@/shared/ui/table'
import { cn } from '@/shared/utils/cn'
import { ColumnResizeHandle } from './column-resize-handle'

interface ResizableTableHeadProps {
  width: number
  minWidth: number
  /** Cột ghim trái: khoảng cách dính tính từ mép trái bảng. */
  left?: number
  className?: string
  title?: string
  children: ReactNode
  onResize: (width: number) => void
}

/**
 * Ô tiêu đề có vạch kéo giãn ở mép phải — dùng cho các bảng NHẬP LIỆU tự dựng
 * (dòng hàng của YCMH / ĐMH), nơi không dùng được `DataTable`.
 */
export function ResizableTableHead({
  width,
  minWidth,
  left,
  className,
  title,
  children,
  onResize,
}: ResizableTableHeadProps) {
  return (
    <TableHead
      className={cn('relative select-none', className)}
      style={{ width, left }}
      title={title}
    >
      {children}
      <ColumnResizeHandle minWidth={minWidth} onResize={onResize} />
    </TableHead>
  )
}
