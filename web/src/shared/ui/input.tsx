import * as React from "react"

import { cn } from "@/shared/utils/cn"

/**
 * Ô số của trình duyệt kèm hai thứ phiền: cặp mũi tên tăng/giảm, và lăn chuột là
 * đổi giá trị. Ở app này ô số toàn là TIỀN và SỐ LƯỢNG nên cả hai đều hại —
 * người dùng cuộn trang qua bảng dòng hàng là đơn giá tự nhảy mà không ai hay.
 * Xử một chỗ tại đây thay vì bắt từng bảng nhớ chép lại đoạn class này.
 */
const NUMBER_INPUT =
  "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"

function Input({ className, type, onFocus, onWheel, ...props }: React.ComponentProps<"input">) {
  const isNumber = type === "number"

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        //  Nền TRẮNG chứ không `bg-transparent`: ô gõ được phải khác ô khóa
        //  (`read-only-value.tsx`, nền `--locked`) ở mọi mặt nền — trong popup,
        //  trên thẻ xám hay trên nền trang đều vậy.
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        isNumber && NUMBER_INPUT,
        className
      )}
      onFocus={(event) => {
        // Ô số mặc định là `0`; bấm vào rồi gõ tiếp thì con trỏ nằm SAU số 0 nên
        // ra "0124". Bôi đen sẵn để lượt gõ đầu tiên thay chỗ số 0 đó.
        if (isNumber && event.target.value === "0") event.target.select()
        onFocus?.(event)
      }}
      onWheel={(event) => {
        if (isNumber) event.currentTarget.blur()
        onWheel?.(event)
      }}
      {...props}
    />
  )
}

export { Input }
