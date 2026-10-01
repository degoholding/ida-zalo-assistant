import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/shared/utils/cn"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  //  Trạng thái NỬA VỜI (`checked="indeterminate"`) — ô "chọn hết" khi mới tick
  //  vài dòng. Bản gốc của shadcn không đụng tới nó: ô vẫn hiện dấu tick trên
  //  nền trắng, nhìn hệt như "chưa chọn gì" mà lại có tick. Vẽ dấu gạch ngang
  //  trên nền đã tô mới đọc ra được là "đang chọn một phần".
  const indeterminate = props.checked === "indeterminate"

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        //  Viền ĐẬM hơn bản gốc shadcn (khách báo 31/08/2026: "cột tick mờ câm").
        //  Bản gốc dùng `border-input` = #e2e8f0, cùng tông với nền sọc của bảng
        //  danh sách nên ô 16px gần như tàng hình — người dùng không thấy có chỗ
        //  để tick. `bg-background` cũng là cố ý: không tô nền thì ô ăn màu sọc
        //  của dòng, mờ thêm một nấc nữa.
        //
        //  Chọn 80% của `--muted-foreground` (#64748b) chứ không đậm hơn nữa: ra
        //  ~#8894a6, đủ 3:1 so với cả nền trắng lẫn nền sọc #f8fafc — đúng ngưỡng
        //  WCAG cho viền của thành phần bấm được, mà chưa nặng như một ô nhập.
        "peer size-4 shrink-0 rounded-[4px] border-[1.5px] border-muted-foreground/80 bg-background shadow-xs transition-colors outline-none",
        //  `enabled:` chứ không phải `hover:` trơn — ô đã khóa mà rê chuột vào
        //  vẫn sáng lên viền xanh thì người dùng bấm hoài không được, tưởng lỗi.
        "enabled:hover:border-primary",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        {indeterminate ? <MinusIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
