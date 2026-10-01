import type { ReactNode } from 'react'

import { cn } from '@/shared/utils/cn'

interface PageHeaderProps {
  /** Tiêu đề — nhận cả JSX để chèn huy hiệu/trạng thái NGAY CẠNH tiêu đề. */
  title: ReactNode
  /** Dòng phụ dưới tiêu đề — nhận cả JSX để chèn trạng thái, huy hiệu… */
  description?: ReactNode
  /**
   * Chèn TRƯỚC tiêu đề — chỗ cho nút quay lại của trang chi tiết. Để cạnh tiêu
   * đề chứ không nhét chung với nhóm nút bên phải: "quay lại" là điều hướng,
   * không phải hành động trên bản ghi.
   */
  leading?: ReactNode
  /** Nút hành động bên phải (Thêm mới, Xuất Excel…). */
  actions?: ReactNode
  /**
   * Lớp phụ cho CỤM NÚT — chỗ để trang tự quyết cách bày nút ở khổ hẹp.
   *
   * Có prop này vì `max-md:w-full` bên dưới chỉ mở đường: nó cho cụm nút chiếm
   * trọn hàng, nhưng bản thân các nút vẫn co theo nội dung nên một nút lẻ đứng
   * dán mép phải với một khoảng trống dài bên trái. Trang nào muốn nút trải đều
   * thì truyền `max-md:[&>button]:flex-1` — xem `room-booking-detail-page`.
   *
   * Không đặt thẳng vào đây làm mặc định: `PageHeader` đang chạy ở 72 màn, mỗi
   * màn một số nút khác nhau, đổi luật chung là đổi hết cả 72.
   */
  actionsClassName?: string
  /**
   * Dính lên đầu khung khi cuộn.
   *
   * Cho trang dài mà nhóm nút nằm TRÊN ĐẦU (Lưu, Bãi bỏ, chuyển tab): cuộn
   * xuống giữa form rồi muốn lưu mà phải cuộn ngược lên đầu thì thao tác nào
   * cũng mất hai lần cuộn.
   *
   * Lề âm để dải này chạy hết bề ngang khung, không thụt vào theo phần đệm của
   * `PageContainer` — dính mà vẫn còn hai mép hở thì nhìn ra ngay là vá víu.
   *
   * ⚠️ **Khoảng hở DƯỚI dải phải là ĐỆM, không phải LỀ** (`mb-0` + `pb-5`). Lề
   * nằm NGOÀI vùng được tô nền: đo 12/09/2026 ở màn chi tiết YCTT, `mb-5` để
   * lại một khe **20px** ngay dưới vạch chân, và nội dung cuộn qua hiện nguyên
   * một vạch chữ cụt trong khe đó (bắt được `<p>` "Mỗi tệp tối đa 50 MB…" của
   * thẻ đính kèm đang trôi ngang qua) — trông đúng như lỗi vẽ. Cùng bài học đã
   * ghi ở `shared/ui/sticky-toolbar.ts`.
   *
   * ⚠️ Khổ điện thoại **bóp đệm dọc lại** (`max-md:pt-2 max-md:pb-3`) và cho
   * hai hàng sát nhau hơn (`max-md:gap-2`). Dải này ghim, nên chiều cao của nó
   * là phần màn hình mất VĨNH VIỄN: màn chi tiết có nút thì nó xuống hai hàng,
   * để nguyên đệm của màn rộng là **117px trên tổng 844px** — một phần bảy màn
   * hình chỉ để bày lại thứ người dùng vừa bấm vào.
   */
  sticky?: boolean
}

/** Tiêu đề chuẩn cho mọi trang — giữ khoảng cách và cỡ chữ đồng nhất. */
export function PageHeader({
  title,
  description,
  leading,
  actions,
  actionsClassName,
  sticky = false,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-wrap items-start justify-between gap-3',
        sticky &&
          'sticky top-0 z-20 -mx-4 -mt-4 mb-0 border-b bg-canvas px-4 pt-3 pb-5 max-md:gap-2 max-md:pt-2 max-md:pb-3 lg:-mx-6 lg:-mt-6 lg:px-6',
      )}
    >
      {/* `min-w-0`: khối tiêu đề phải CO ĐƯỢC, nếu không nó luôn đòi bề rộng của
          dòng mô tả dài nhất và đẩy cụm nút xuống một hàng riêng ngay từ ~820px
          — `flex-wrap` xuống dòng TRƯỚC khi co, nên không có vế này thì chữ
          không bao giờ tự ngắt. Có nó: mô tả ngắt làm hai dòng, cụm nút ở lại
          bên phải tiêu đề (báo 09/09/2026 ở màn Quỹ phép năm).

          `flex-[1_1_16rem]` chứ KHÔNG `flex-1`: `flex-1` đặt cỡ gốc bằng 0, tức
          khối tiêu đề không đòi lấy một pixel nào và cụm nút cứ thế lấn hết —
          màn chi tiết 4 nút ở 768px bóp tiêu đề còn ~60px, «Đơn nghỉ phép NP010»
          rơi xuống thành bốn dòng mỗi dòng một chữ, trong khi cụm nút vẫn nằm
          thong dong một hàng (báo 09/09/2026). 16rem là mức tiêu đề đòi giữ:
          còn đủ chỗ thì nút vẫn ở cùng hàng, không đủ thì cả cụm nút xuống hàng
          riêng — đúng thứ tự ưu tiên, vì tiêu đề nói ĐANG XEM CÁI GÌ. */}
      <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
        {leading}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-navy">{title}</h1>
          {description && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              {description}
            </div>
          )}
        </div>
      </div>
      {/* `flex-wrap` bắt buộc: trang chi tiết có màn tới 8 nút, không cho xuống
          dòng thì cụm nút đẩy rộng cả trang và sinh THANH CUỘN NGANG cho toàn
          trang — đã gặp ở màn chi tiết văn bản. `justify-end` để khi xuống dòng
          các nút vẫn bám mép phải, không trôi vào giữa.

          `max-md:w-full`: dưới 640px nhóm này luôn xuống hàng riêng, và một khối
          co theo nội dung ở đó khiến `w-full` của nút bên trong quy về đúng bề
          rộng cũ — tức không trang nào ép được nút trải hết hàng trên điện
          thoại, dù đó là cách bày hành động chính dễ bấm nhất. Chiếm trọn hàng
          không đổi gì với các trang khác: `justify-end` vẫn giữ nút bám mép
          phải, chỉ khác là mép phải của TRANG thay vì của cụm nút. */}
      {actions && (
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center justify-end gap-2 max-md:w-full',
            actionsClassName,
          )}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
