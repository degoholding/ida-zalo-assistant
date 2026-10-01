"use client"

import * as React from "react"

import { cn } from "@/shared/utils/cn"

function Table({
  className,
  containerClassName,
  containerRef,
  ...props
}: React.ComponentProps<"table"> & {
  /**
   * Class cho khung cuộn bao ngoài `<table>`. Cần khi bảng phải cao bằng khung
   * chứa và tự cuộn dọc — không có nó thì không với tới được div này.
   */
  containerClassName?: string
  /**
   * Ref tới khung CUỘN bao ngoài `<table>`, không phải tới chính `<table>`.
   *
   * Cần vì `scrollLeft` / `clientWidth` nằm ở div này chứ không nằm ở thẻ
   * `<table>` (thẻ bảng rộng đúng bằng nội dung, nó không hề cuộn). Đo nhầm
   * vào `<table>` thì `scrollWidth === clientWidth` ở mọi lúc và mọi phép dò
   * tràn ngang đều trả về "không tràn" — sai im lặng. Xem
   * `useHorizontalOverflow`.
   */
  containerRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        //  ⚠️ `has-aria-expanded` để nền ĐỤC (`bg-muted`), không phải
        //  `bg-muted/50` như bản shadcn gốc. Hàng có nút bung (`aria-expanded`)
        //  sẽ dính nền alpha, mà ô của CỘT GHIM lấy `bg-inherit` từ hàng —
        //  nền trong suốt là phần bảng đang cuộn ngang lộ xuyên qua cột dính.
        //  Xem `docs/ui/table.md` mục 5, bẫy số 6.
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle font-semibold whitespace-nowrap text-muted-foreground text-[13px] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2.5 align-middle whitespace-nowrap text-[13.5px] text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
