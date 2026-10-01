"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/shared/utils/cn"

/**
 * ⚠️ SỬA SO VỚI BẢN SHADCN GỐC — **bỏ qua `onValueChange("")`**. Đây là chỗ mất
 * dữ liệu, không phải chuyện thẩm mỹ (lỗi khách báo 24/08/2026).
 *
 * Radix dựng kèm một thẻ `<select>` NGUYÊN BẢN ẩn đi (cho autofill và reset
 * form). Danh mục ở các form chi tiết nạp **bất đồng bộ**, nên có một nhịp mà
 * `value` đã là `"5"` trong khi `<option value="5">` chưa kịp sinh ra. Trình
 * duyệt thấy select không có option nào khớp thì kéo giá trị về **rỗng** và bắn
 * sự kiện `change` — Radix chuyển tiếp thành `onValueChange("")`, y như người
 * dùng vừa tự tay chọn. Bên gọi thường viết `Number(value)` → thành **0**, ghi
 * đè trường trong form, và lần bấm *Lưu* kế tiếp gửi số 0 đó xuống máy chủ.
 *
 * Triệu chứng người dùng thấy: chọn trưởng bộ phận (hoặc phòng ban của nhân sự),
 * bấm Lưu, ô trở lại «— Chưa chỉ định —» và dữ liệu mất thật.
 *
 * Chặn được ở đây vì **Radix cấm `<SelectItem value="">`**: chuỗi rỗng không bao
 * giờ là lựa chọn hợp lệ của người dùng, nên bỏ qua nó không che mất thao tác
 * nào. Vá một chỗ thay vì rải `if (!next) return` ra vài chục ô chọn.
 */
function Select({
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return (
    <SelectPrimitive.Root
      data-slot="select"
      onValueChange={(value) => {
        if (!value) return
        onValueChange?.(value)
      }}
      {...props}
    />
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        //  Nền TRẮNG chứ không `bg-transparent`: ô chọn được phải khác ô khóa
        //  (`read-only-value.tsx`, nền `--locked`) ở mọi mặt nền.
        //
        //  ⚠️ `min-w-0` là chốt CHỐNG TRÀN NGANG, đừng gỡ. Ô này `whitespace-nowrap`
        //  nên bề rộng nội tại của nó bằng đúng độ dài nhãn đang chọn; mà phần tử
        //  con của flex/grid mặc định `min-width: auto`, tức KHÔNG co xuống dưới
        //  mức đó — `w-full` của người gọi thua. Một nhãn dài như
        //  «DEMO_MANAGER_PURCHASE — Trưởng phòng Thu mua (Demo)» vì thế đẩy cả ô
        //  vượt mép phải màn hình và kéo theo cả trang tràn ngang (khách báo
        //  10/09/2026 ở chi tiết Phòng ban). Có `min-w-0` thì `line-clamp-1` sẵn
        //  có ở dưới mới cắt được nhãn bằng «…». Không ảnh hưởng ô để `w-fit`:
        //  chúng vẫn co giãn theo nội dung khi khung chứa còn đủ chỗ.
        "flex w-fit min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

/*  bao-CR-475 — mặc định SỔ NGAY DƯỚI Ô (`popper`), không còn `item-aligned`.
 *
 *  `item-aligned` (mặc định của Radix/shadcn) căn cho mục ĐANG CHỌN nằm đè lên ô: danh
 *  sách dài (nhân sự, NCC…) bung kín cả màn hình, kèm mũi tên cuộn trên/dưới, người dùng
 *  không thấy ô mình đang sửa nữa (đại ca chụp lỗi ở ô «Nhân sự YC», 24/09/2026). Nay mọi
 *  ô chọn sổ xuống dưới, cao tối đa 20rem rồi cuộn trong khung. Ô nào cần kiểu cũ thì tự
 *  truyền `position="item-aligned"`. Danh sách lấy từ DANH MỤC DÀI thì dùng
 *  `SearchSelect` (gõ để tìm), đừng dùng `Select`. */
function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          position === "popper" &&
            "max-h-[min(var(--radix-select-content-available-height),20rem)] data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  description,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  /**
   * Dòng phụ giải thích lựa chọn này, hiện trong danh sách bung ra.
   *
   * ⚠️ Cố ý nằm NGOÀI `ItemText`: Radix chiếu nguyên nội dung `ItemText` lên ô
   * chọn khi mục được chọn, nên nhét câu giải thích vào trong là ô chọn cao 36px
   * phải chứa hai dòng chữ. Để ngoài thì danh sách có dòng phụ, còn ô chọn vẫn
   * chỉ mỗi cái tên.
   */
  description?: React.ReactNode
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        description && "flex-col items-start gap-0.5",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {/*  `<p>` chứ không phải `<span>`: luật `*:[span]:last:flex` ở trên nhắm
           vào thẻ span CUỐI CÙNG — để span thì nó cướp mất luật đó của
           `ItemText`. */}
      {description && (
        <p
          data-slot="select-item-description"
          className="max-w-80 text-xs leading-snug text-pretty text-muted-foreground"
        >
          {description}
        </p>
      )}
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
