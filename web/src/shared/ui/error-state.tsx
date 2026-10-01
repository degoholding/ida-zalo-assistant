import type { ReactNode } from 'react'

import { cn } from '@/shared/utils/cn'

interface ErrorStateProps {
  /** Mã hiện to phía trên (vd `404`). Bỏ trống khi lỗi không có mã. */
  code?: string
  title: string
  description: string
  /** Chi tiết kỹ thuật để người dùng copy gửi khi báo lỗi. */
  detail?: string
  /** Các nút hành động — trang gọi tự quyết định. */
  children?: ReactNode
  /** `true` khi dùng ngoài khung app (chưa có header/menu) để chiếm hết màn hình. */
  fullScreen?: boolean
}

/**
 * Khung hiển thị chung cho mọi màn lỗi (404, lỗi route, lỗi render). Gom về một
 * chỗ để ba màn này không trôi khác nhau về bố cục và cỡ chữ.
 */
export function ErrorState({
  code,
  title,
  description,
  detail,
  children,
  fullScreen = false,
}: ErrorStateProps) {
  return (
    //  `px-4` ở khổ hẹp cho khớp phần đệm của `PageContainer`; 24px làm câu mô
    //  tả gãy sớm hơn cần thiết trên máy 320px.
    <div
      className={cn(
        'flex flex-col items-center justify-center px-4 text-center sm:px-6',
        fullScreen ? 'min-h-dvh bg-canvas' : 'min-h-[60dvh]',
      )}
    >
      {code && <p className="text-5xl font-semibold text-primary">{code}</p>}

      <h1 className={cn('text-lg font-medium text-navy', code && 'mt-3')}>{title}</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>

      {children && (
        //  ⚠️ Khổ hẹp XẾP DỌC và nút TRẢI HẾT HÀNG (`w-full` cho con trực tiếp).
        //  Màn lỗi thường có hai nút («Tải lại trang» + «Về màn chọn phân hệ»)
        //  cộng lại ~330px — ở 320px chúng xuống hai hàng, mỗi nút một bề rộng
        //  khác nhau nằm giữa hai khoảng trắng lệch, đọc ra như hai mẩu rời chứ
        //  không như một cặp lựa chọn. Mà đây lại là chỗ người dùng đang bối
        //  rối nhất và chỉ có đúng hai đường đi tiếp — vùng chạm phải to và
        //  thẳng hàng.
        <div className="mt-6 flex w-full max-w-xs flex-col gap-2 [&>*]:w-full sm:w-auto sm:max-w-none sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3 sm:[&>*]:w-auto">
          {children}
        </div>
      )}

      {detail && (
        //  ⚠️ `w-full` là chốt CHỐNG TRÀN, không phải trang trí — và nó phải đi
        //  CÙNG `break-words`. Khối cha là `flex flex-col items-center`, nên bề
        //  rộng của con là fit-content: với một URL không có chỗ ngắt, cái đó
        //  bằng max-content (đo 12/09/2026: **426px trong khung 390px**, thẻ
        //  bắt đầu ở `x = -18`), mà `max-w-lg` = 512px thì không chặn nổi.
        //  `overflow-wrap` chỉ bẻ khi bề rộng đã bị chặn, nên thiếu `w-full` là
        //  chuỗi tràn ra cả hai mép và bị xén hai đầu.
        //
        //  ⚠️ `break-words` chứ KHÔNG `break-all`. Chuỗi này là câu lỗi lẫn URL
        //  («Failed to fetch dynamically imported module: http://…»): `break-all`
        //  cắt giữa MỌI từ nên phần chữ vỡ vụn từng khúc ba bốn ký tự, trong
        //  khi thứ cần bẻ chỉ là cái URL dài. Bản cũ dùng `break-all` nên vô
        //  tình không tràn — nhưng đổi sang `break-words` mà quên `w-full` thì
        //  lỗi tràn lộ ra ngay.
        <p className="mt-6 w-full max-w-lg font-mono text-xs break-words text-muted-foreground/70">
          {detail}
        </p>
      )}
    </div>
  )
}
