/**
 * Khóa của tab «Thông tin» — tab luôn có, do `CrudDetailPage` tự dựng chứ không
 * khai trong `CrudConfig.tabs`. Cũng là giá trị mặc định nên nó **không ghi vào
 * URL** (`useUrlParamState` xóa param khi trùng mặc định), giữ link sạch.
 */
export const TAB_INFO = 'info'

/**
 * Chốt tab đang mở từ param `?tab=` trên URL.
 *
 * ⚠️ **Phải đối chiếu với danh sách tab CÓ THẬT.** Radix `Tabs` là component có
 * kiểm soát: đưa cho nó một `value` không khớp trigger nào thì nó không báo lỗi,
 * nó chỉ **không dựng tab nào cả** — trang hiện ra một khoảng trắng dưới hàng
 * tab. Hai đường dẫn tới đó đều bình thường: link cũ trỏ vào một tab về sau bị
 * bỏ, và người dùng sửa tay thanh địa chỉ.
 */
export function resolveTabKey(
  tabParam: string,
  tabs: readonly { key: string }[] | undefined,
): string {
  if (tabParam === TAB_INFO) return TAB_INFO
  return tabs?.some((tab) => tab.key === tabParam) ? tabParam : TAB_INFO
}
