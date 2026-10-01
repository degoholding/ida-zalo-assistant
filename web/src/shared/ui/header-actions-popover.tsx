import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'

/**
 * Nút `⋯` gom các lệnh PHỤ của đầu trang chi tiết ở khổ điện thoại.
 *
 * Trang chi tiết Văn bản có tới tám lệnh, Phiếu khảo sát tới sáu; bày hết ra thì
 * cụm nút tràn **hai đến ba hàng** ngay dưới tiêu đề, tức 110–130px của màn 844px
 * dành cho những thứ người ta chạm tới vài lần một buổi — trong khi phần cần nhìn
 * (trang giấy, biểu mẫu) bị đẩy xuống dưới nếp gấp. Dải đầu trang nào có ghim thì
 * chỗ đó còn là chỗ mất VĨNH VIỄN.
 *
 * ⚠️ **Dựng nhóm phụ MỘT LẦN rồi để `useIsMobile` chọn khung bọc** — đừng dựng
 * hai bản rồi ẩn một bằng CSS. Nút ở đây thường mang hộp thoại và truy vấn riêng
 * (menu *Tệp*, *Chữ ký*, xác nhận *Xóa*): bản bị ẩn vẫn gắn kết và vẫn gọi API,
 * chỉ là không ai thấy. Xem `detail-page-shell` hoặc `survey-detail-page`.
 *
 * ⚠️ **Chỉ lệnh PHỤ vào đây, nút CHÍNH của trạng thái hiện tại phải ở ngoài.**
 * Luật chia đúng bằng dáng nút: `variant="default"` (nền xanh) là việc mà người
 * mở trang đang định làm — *Lưu nội dung*, *Duyệt và ban hành*, *Ban hành* — giấu
 * nó sau một nút `⋯` là bắt thêm một chạm cho đúng thao tác thường xuyên nhất.
 * Mấy nút viền (*Tệp*, *Chữ ký*, *Sao chép*, *Bãi bỏ*…) thì ngược lại.
 *
 * ⚠️ **Xếp DỌC, mỗi lệnh trọn bề ngang, CÓ CHỮ.** Cụm ngoài thanh rút được về
 * biểu tượng vì nó nằm cạnh nhau nên đọc theo cụm; trong tấm popover thì mỗi
 * dòng đứng một mình, một cột biểu tượng không chữ là bắt đoán từng cái.
 *
 * ⚠️ Nút con ở đây hay tự mở thêm một lớp nổi nữa (menu *Tệp*, hộp thoại *Chữ
 * ký*, xác nhận *Xóa*). Lớp đó portal ra ngoài tấm popover nên Radix tính là
 * «bấm ra ngoài» và đóng popover lại — **đúng ý muốn**: chọn xong một lệnh thì
 * tấm này không còn việc gì để ở lại.
 */
export function HeaderActionsPopover({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Lệnh khác">
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>

      {/*  `align="end"` để tấm bám mép phải — nút `⋯` đứng cuối cụm, mở ra giữa
           màn thì mất liên hệ với chỗ vừa bấm.

           ⚠️ **Lột dáng NÚT của các mục, biến chúng thành DÒNG MENU.** Mấy lệnh
           này vốn là nút viền của một thanh ngang; xếp dọc mà giữ nguyên viền thì
           tấm popover thành một CHỒNG HỘP — sáu khung bo góc xếp chồng, mỗi khung
           một bề rộng chữ khác nhau, lại thêm nút *Xóa* kiểu `ghost` không viền
           nằm lạc lõng ở cuối. Người đọc thấy một đống nút rời chứ không thấy một
           danh sách lệnh.

           Gỡ viền · nền · đổ bóng, cho cao bằng nhau, trải hết bề ngang và canh
           trái theo biểu tượng — đúng dáng một menu. Bộ chọn hậu duệ
           (`.x :is(button,a)`, 0-1-1) đè được lớp của `buttonVariants` (0-1-0) nên
           không phải sửa từng nút ở nơi khai.

           ⚠️ **Phải bắt cả `a`, không chỉ `button`.** Lệnh nào mở một trang khác
           thì khai bằng `<Button asChild><Link/></Button>` — Radix `Slot` nhả ra
           thẻ `<a>`, nên bộ chọn chỉ nhắm `button` trượt sạch mấy nút đó. Bắt được
           ngay ở đầu trang Đơn mua hàng: năm nút *In …* giữ nguyên viền trong khi
           *Nhân bản* đã phẳng, tấm popover ra một chồng hộp lẫn với dòng menu.
           Dùng `:is(button,a)` chứ đừng viết `[&_button,&_a]` — dấu phẩy trong
           biến thể tùy ý là chỗ dễ vỡ khi đổi phiên bản Tailwind. */}
      <PopoverContent
        align="end"
        className="flex w-56 flex-col gap-0.5 p-1 [&_:is(button,a)]:h-9 [&_:is(button,a)]:w-full [&_:is(button,a)]:justify-start [&_:is(button,a)]:gap-2 [&_:is(button,a)]:rounded-sm [&_:is(button,a)]:border-0 [&_:is(button,a)]:bg-transparent [&_:is(button,a)]:px-2 [&_:is(button,a)]:font-normal [&_:is(button,a)]:shadow-none [&_:is(button,a):hover]:bg-accent"
        //  ⚠️ Đừng kéo tiêu điểm vào mục đầu. Radix mặc định làm vậy, và trên
        //  máy cảm ứng nó vẽ một VÒNG SÁNG quanh dòng trên cùng — người dùng đọc
        //  ra là "mục này đang được chọn" chứ không phải "đây là danh sách, chọn
        //  đi". Bàn phím vẫn vào được bằng Tab và thoát bằng Escape.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
