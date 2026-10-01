import type { ReactNode } from 'react'

import { TONE_CLASS, type StatusTone } from '@/shared/ui/status-tone'
import { cn } from '@/shared/utils/cn'

interface PillProps {
  tone?: StatusTone
  children: ReactNode
  className?: string
}

/** Nhãn nhỏ một dòng (loại, trạng thái, thẻ) — màu theo `TONE_CLASS` để mọi phân hệ cùng một bảng màu. */
export function Pill({ tone = 'neutral', children, className }: PillProps) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap', TONE_CLASS[tone], className)}>
      {children}
    </span>
  )
}
