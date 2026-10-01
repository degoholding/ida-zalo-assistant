import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip'

interface IconTooltipProps {
  /** Chữ hiện ra khi rê chuột. Cũng nên là `aria-label` của chính phần tử con. */
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** MỘT phần tử DOM (nút, span…) — tooltip gắn thẳng vào nó qua `asChild`. */
  children: React.ReactNode
}

/**
 * Bọc một biểu tượng / nút biểu tượng bằng tooltip chữ ngắn.
 *
 * Có sẵn `TooltipProvider` bên trong thay vì bắt trang gọi tự dựng — cùng lối
 * với `HelpHint`. Không dùng `title=""` của HTML: nó chờ ~1 giây mới hiện, hiện
 * bằng khung của hệ điều hành nên không theo bộ giao diện, và trên cảm ứng thì
 * không bao giờ hiện.
 */
export function IconTooltip({ label, side = 'top', children }: IconTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
