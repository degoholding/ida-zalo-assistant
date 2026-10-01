"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      {...props}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        ...props.icons,
      }}
      toastOptions={{
        classNames: {
          //  Bóng gọn, bo tròn; chừa lề PHẢI đủ cho nút đóng lớn nằm giữa cạnh phải.
          //  `!` vì luật gốc của sonner (`[data-sonner-toast][data-styled]`) đặc tả
          //  cao hơn một lớp Tailwind thường; `!important` thắng cả hai.
          //  `w-fit` -> bóng ôm sát nội dung (bằng chữ), `max-w` để chữ dài thì xuống
          //  dòng; `items-center` canh icon/chữ/nút X theo chiều cao.
          //  Nút X nay vắt qua GÓC TRÊN PHẢI (tâm trùng đỉnh góc) nên lề trái/phải
          //  cân nhau; `overflow-visible` để nửa nút ló ra ngoài khung không bị cắt.
          //  `pr-9` chừa chỗ cho nút X nằm TRONG khung + một khoảng cách với chữ.
          toast: "w-fit! max-w-[92vw]! items-center! gap-2.5! rounded-xl! pl-3.5! pr-9! py-3! text-[13.5px]! leading-snug! sm:max-w-md!",
          //  Nút X: TRONG khung, ghim bên PHẢI và canh GIỮA chiều cao hàng
          //  (`top-1/2` + `translateY(-50%)`). Vòng đếm (::before) bao quanh theo.
          closeButton:
            "left-auto! right-2.5! top-1/2! bottom-auto! [transform:translateY(-50%)]! m-0! size-4! rounded-full! border-0! bg-transparent! p-0! text-muted-foreground! opacity-100! transition-colors! hover:bg-foreground/10! hover:text-foreground! [&>svg]:size-3!",
        },
        ...props.toastOptions,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          //  Vị trí nút đóng nay do `classNames.closeButton` lo (giữa cạnh phải).
          ...props.style,
        } as React.CSSProperties
      }
    />
  )
}

export { Toaster }
