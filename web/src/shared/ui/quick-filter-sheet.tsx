import { Filter } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { cn } from '@/shared/utils/cn'

export interface QuickFilterSheetProps {
  activeCount?: number
  onClearAll?: () => void
  children: ReactNode
  /**
   * Nút bấm rút còn BIỂU TƯỢNG — dùng khi thanh công cụ phải gói ô tìm và mấy
   * nút vào **một hàng** ở khổ điện thoại, chỗ mà 48px của chữ «Bộ lọc» là phần
   * chênh giữa vừa và không vừa.
   *
   * ⚠️ Vẫn **giữ viền** (`variant="outline"`) chứ không để nền chìm: nó đứng
   * cạnh mấy nút biểu tượng khác cũng có viền (Export, Tải lại), một nút trơn
   * lọt giữa chúng đọc ra như đang bị tắt.
   *
   * ⚠️ **Mất chữ là mất thật** — người dùng phải đoán cái phễu làm gì. Chỉ đổi
   * khi thật sự cần chỗ; hàng nào còn rộng thì để bản có chữ.
   */
  iconOnly?: boolean
  /**
   * Chạy khi bấm nút chính, TRƯỚC khi đóng tờ trượt.
   *
   * Có để nhúng được bộ lọc nâng cao (`ConditionalFilterBody`), thứ giữ điều
   * kiện ở dạng NHÁP cho tới khi ai đó gọi `apply()`. Không có nó thì người dùng
   * gõ xong ba điều kiện, bấm nút duy nhất trong tầm mắt, tờ trượt đóng lại và
   * danh sách không đổi gì — nhìn ra y như hệ thống nuốt mất thao tác.
   *
   * Bỏ trống thì nút chỉ đóng tờ trượt và mang chữ «Xong»: những ô lọc nhanh ăn
   * ngay lúc chọn nên không có gì để «áp dụng».
   */
  onApply?: () => void
}

/**
 * Tờ trượt lên từ đáy chứa các ô LỌC NHANH ở khổ điện thoại.
 *
 * Trên màn rộng những ô đó xếp thẳng hàng trên thanh công cụ; dưới 768px một
 * hàng không chứa nổi chúng, mà thanh công cụ lại thường được ghim đầu trang
 * nên mỗi pixel đều là pixel che mất danh sách. Gom vào tờ trượt: hàng công cụ
 * còn một dòng, và lúc mở ra thì mỗi ô có trọn bề ngang màn hình.
 *
 * ⚠️ **Ô trong tờ trượt phải có NHÃN** — bọc bằng `QuickFilterField`. Trên thanh
 * công cụ, ô chọn tự giải nghĩa bằng giá trị đang chọn («Tất cả loại nghỉ»);
 * xếp dọc ba bốn ô như vậy trong một tờ trắng thì thành một danh sách chữ trôi
 * nổi, người đọc không biết ô nào lọc cái gì cho tới khi bấm thử.
 */
export function QuickFilterSheet({
  activeCount = 0,
  onClearAll,
  children,
  iconOnly = false,
  onApply,
}: QuickFilterSheetProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? 'icon' : 'sm'}
          aria-label="Bộ lọc"
          className={cn('relative shrink-0 md:hidden', !iconOnly && 'h-9 gap-1.5 px-3 text-xs')}
        >
          <Filter className="size-4" />
          {!iconOnly && <span>Bộ lọc</span>}

          {/*  Bản biểu tượng báo bằng CHẤM chứ không bằng số: nút chỉ rộng 36px,
               nhét một huy hiệu số vào là nó đè lên chính cái phễu. Con số đầy
               đủ vẫn có ở tiêu đề tờ trượt. */}
          {activeCount > 0 &&
            (iconOnly ? (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary"
              />
            ) : (
              <Badge variant="default" className="h-4 rounded-full px-1.5 text-[10px]">
                {activeCount}
              </Badge>
            ))}
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl p-0">
        {/*  Thanh vuốt — dấu hiệu quy ước của tờ trượt từ đáy, nói rằng kéo
             xuống là đóng được. Thiếu nó thì đường duy nhất để đóng là nút X bé
             ở góc, mà ngón cái với tới góc trên màn 6" là chuyện khó. */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
        </div>

        <SheetHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 pt-2 pb-3">
          <SheetTitle className="text-base font-semibold">Bộ lọc</SheetTitle>
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {activeCount} đang lọc
            </Badge>
          )}
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto px-4 py-4">{children}</div>

        {/*  Hai nút CÙNG HÀNG, «Xóa lọc» chỉ hiện khi có gì để xóa. Bản cũ để
             «Xóa lọc» tận trên tiêu đề — xa nút chính, và ở đúng vùng ngón tay
             không với tới. */}
        <div className="flex gap-2 border-t px-4 py-3">
          {onClearAll && activeCount > 0 && (
            <Button variant="outline" className="h-10 flex-1" onClick={onClearAll}>
              Xóa lọc
            </Button>
          )}
          <Button
            className="h-10 flex-1"
            onClick={() => {
              onApply?.()
              setOpen(false)
            }}
          >
            {onApply ? 'Áp dụng' : 'Xong'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Một ô lọc trong tờ trượt: nhãn ở trên, ô nhập trải hết bề ngang ở dưới. */
export function QuickFilterField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
