import { HelpCircle } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/ui/tooltip'
import { cn } from '@/shared/utils/cn'

interface HelpHintProps {
  /** Câu giải thích. Rỗng thì KHÔNG vẽ gì — nút hỏi mà bấm ra ô trống còn tệ hơn không có. */
  children?: string
  /** Đọc cho trình đọc màn hình; mặc định đủ dùng cho hầu hết chỗ. */
  label?: string
  className?: string
}

/**
 * Nút `?` nhỏ, rê chuột vào thì hiện một câu giải thích.
 *
 * Dùng cho những nhãn nghiệp vụ mà tên gọi KHÔNG tự giải thích: mười loại quan
 * hệ văn bản ("Thuộc về", "Kèm theo", "Bổ sung"…) nghe gần giống nhau, người
 * dùng chọn theo cảm giác rồi lát nữa bị chặn gửi duyệt vì một quan hệ họ còn
 * không định đặt ra.
 *
 * Cố ý là TOOLTIP chứ không phải chữ giải thích in thẳng ra: những câu này chỉ
 * cần lúc phân vân. In hết ra thì mỗi dòng quan hệ dài gấp ba, và danh sách tám
 * dòng thành một trang chữ.
 *
 * `TooltipProvider` gói ngay trong đây thay vì bắt trang gọi phải tự dựng: cả
 * ứng dụng mới chỉ có `sidebar` mount một cái, nên dùng ở bất cứ chỗ nào khác là
 * tooltip lặng lẽ không hiện.
 *
 * Trigger là `<button type="button">`: nằm trong `<form>` mà để mặc định thì nó
 * là nút submit, rê chuột xong bấm nhầm là gửi cả biểu mẫu.
 */
export function HelpHint({ children, label = 'Giải thích', className }: HelpHintProps) {
  if (!children) return null

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(
              'inline-flex shrink-0 text-muted-foreground transition-colors hover:text-foreground',
              className,
            )}
          >
            <HelpCircle className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-pretty">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
