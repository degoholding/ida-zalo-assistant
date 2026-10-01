import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/shared/utils/cn"
import { Button } from "@/shared/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        //  ⚠️ CHÍNH LỚP NÀY là khung cuộn của hộp thoại — xem ghi chú ở
        //  `DialogContent`. `overscroll-contain` để cuộn hết hộp thì dừng, không
        //  đẩy tiếp trang nền phía sau.
        "fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    /*  ⚠️ Overlay BỌC nội dung, không phải anh em của nó.
     *
     *  Bản shadcn gốc để `<DialogOverlay />` tự đóng rồi đặt `Content` cạnh nó,
     *  và `Content` tự căn giữa bằng `fixed top-1/2 left-1/2 -translate-1/2`.
     *  Hộp thoại nào cao hơn màn hình thì phần tràn nằm NGOÀI mọi khung cuộn:
     *  lăn chuột không ăn, mà phần trên còn bị đẩy khuất lên trên mép màn.
     *
     *  Nay overlay là khung cuộn (`overflow-y-auto`), bên trong nó một lớp
     *  `flex min-h-full items-center` lo căn giữa. Hộp thấp thì vẫn nằm chính
     *  giữa y như cũ; hộp cao thì cuộn được và không mất phần đầu — `min-h-full`
     *  + `items-center` là mấu chốt, chỉ dùng `place-items-center` thôi thì nội
     *  dung cao hơn khung sẽ bị cắt cụt phía trên và không cuộn ngược lên được.
     *
     *  Hệ quả: màn nào cần cuộn thì ĐỪNG tự đặt `max-h-… overflow-y-auto` lên
     *  `DialogContent` nữa. Hai khung cuộn lồng nhau chính là thứ làm con lăn
     *  chuột chết ở hộp Quản lý dự án (03/09/2026).  */
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay>
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPrimitive.Content
            data-slot="dialog-content"
            className={cn(
              "relative z-50 grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
              className
            )}
            {...props}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close
                data-slot="dialog-close"
                className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogOverlay>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
