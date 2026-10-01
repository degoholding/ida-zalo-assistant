import type { ReactNode } from 'react'

import { cn } from '@/shared/utils/cn'

/**
 * Tiêu đề block chuẩn: chữ nhỏ IN HOA, giãn chữ, xám, có vạch ngăn dưới —
 * KHÔNG icon. Đúng kiểu `FormSection` đang dùng, tách ra để các block KHÔNG phải
 * form (chữ ký, kiêm nhiệm, tài khoản…) hiển thị tiêu đề đồng nhất với nhau.
 */
export function SectionHeading({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h3
      className={cn(
        'border-b pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </h3>
  )
}
