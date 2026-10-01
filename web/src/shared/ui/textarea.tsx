import * as React from "react"

import { cn } from "@/shared/utils/cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        //  Nền TRẮNG chứ không `bg-transparent`: ô gõ được phải khác ô khóa
        //  (`read-only-value.tsx`, nền `--locked`) ở mọi mặt nền — trong popup,
        //  trên thẻ xám hay trên nền trang đều vậy.
        "field-sizing-content min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
