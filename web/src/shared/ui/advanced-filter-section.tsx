import { ConditionalFilterBody } from '@/shared/conditional-filter'

/**
 * Mục **Lọc nâng cao** đặt trong tờ trượt lọc của khổ điện thoại
 * (`QuickFilterSheet`).
 *
 * Ở màn rộng, bộ lọc điều kiện mở bằng nút riêng + popover
 * (`<ConditionalFilter />`). Khổ hẹp không dùng lại được đường đó: popover neo
 * vào nút, mà nút thì nằm trong một thanh công cụ đã bị ghim sát đỉnh, nên tấm
 * popover `95vw` bung ra che gần hết màn và vẫn không đủ ngang cho một hàng
 * điều kiện. Nhúng thẳng phần ruột vào tờ trượt thì hàng điều kiện được xếp dọc
 * (xem `FilterRowItem`) và cả màn hình rộng ngang là chỗ của nó.
 *
 * ⚠️ **`actions={false}` — mục này KHÔNG dựng nút «Áp dụng» của riêng nó.** Tờ
 * trượt đã có nút chính ở chân, và nút đó gọi `apply()` qua
 * `QuickFilterSheetProps.onApply`. Hai nút «Áp dụng» trong một tấm thì người
 * dùng phải đoán cái nào ăn — đoán sai là mất trắng mấy điều kiện vừa gõ.
 *
 * ⚠️ **`inPopover={false}`** là bắt buộc: chân bộ lọc mặc định bọc nút bằng
 * `PopoverClose`, thứ chỉ chạy trong một `Popover.Root`. Để mặc định thì Radix
 * ném lỗi ngữ cảnh ngay lúc mở tờ trượt.
 */
export function AdvancedFilterSection() {
  return (
    <div className="space-y-2 border-t pt-4">
      <span className="text-xs font-medium text-muted-foreground">Lọc nâng cao</span>
      <ConditionalFilterBody actions={false} inPopover={false} />
    </div>
  )
}
