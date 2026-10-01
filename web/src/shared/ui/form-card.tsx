import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { cn } from '@/shared/utils/cn'

interface FormCardProps {
  title: string
  /** Biểu tượng bên trái tiêu đề — giúp nhận ra nhóm khi lướt nhanh. */
  icon?: LucideIcon
  /** Lớp màu cho biểu tượng, vd `text-primary`. */
  iconClassName?: string
  /** Nút phụ nằm bên phải tiêu đề (vd "Chọn tệp"). */
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/**
 * Thẻ bọc một nhóm trường trong form chi tiết — khuôn CHẶT, không phải khuôn
 * mặc định của shadcn.
 *
 * `Card` gốc để `py-6`/`px-6` và `FormItem` để `gap-2`: một thẻ 6 ô đã dài quá
 * màn hình, phải cuộn mới thấy hết. Bóp lại đúng bằng khuôn mà màn Yêu cầu mua
 * hàng và Nhân sự đang dùng (xem `purchase-request-info-card.tsx`) để mọi form
 * trong hệ nhìn như nhau.
 *
 * Hai selector con siết bên TRONG từng ô (nhãn ↔ input ↔ chú thích). Đặt ở đây
 * chứ không sửa `FormItem` trong `shared/ui/form.tsx` vì đó là primitive dùng
 * chung — sửa gốc là đổi luôn mọi form khác của hệ.
 */
export function FormCard({
  title,
  icon: Icon,
  iconClassName,
  actions,
  children,
  className,
  contentClassName,
}: FormCardProps) {
  return (
    <Card className={cn('gap-4 py-4', className)}>
      {/* Vạch ngăn nét ĐỨT: nét liền dễ bị đọc nhầm thành mép trên của bảng dữ
          liệu, còn nét đứt đọc ra ngay là "hết tiêu đề, bắt đầu ô nhập". */}
      <CardHeader className="flex min-h-9 flex-row items-center gap-2.5 border-b border-dashed px-4 pb-3!">
        {Icon && <Icon className={cn('size-4.5 shrink-0', iconClassName)} />}
        <CardTitle className="text-base text-navy dark:text-foreground">{title}</CardTitle>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </CardHeader>

      <CardContent
        className={cn(
          'px-4',
          '[&_[data-slot=form-item]]:gap-1.5',
          '[&_[data-slot=form-description]]:text-xs',
          contentClassName,
        )}
      >
        {children}
      </CardContent>
    </Card>
  )
}
