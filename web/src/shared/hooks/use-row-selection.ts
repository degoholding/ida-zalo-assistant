import { useCallback, useState } from 'react'

/**
 * TICK CHỌN NHIỀU DÒNG của một bảng — `Set<number>` id đang chọn + bật/tắt
 * từng dòng + bật/tắt CẢ TRANG hiện tại. Dùng chung cho mọi bảng có thao tác
 * HÀNG LOẠT (đầu tiên: bảng «Văn bản» trong thư mục và màn Văn bản, phase 05/06).
 *
 * ⚠️ KHÔNG có khái niệm "chọn tất cả" chạy phía server — `selectedIds` chỉ là
 * những id CLIENT đang thấy trên trang đã tick, đúng luật "Thấy một phần"
 * (phase 04): người xem có thể chỉ đọc được MỘT PHẦN bản ghi trong một trang,
 * "chọn tất cả" kiểu server sẽ động tới cả phần họ không thấy.
 */
export function useRowSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const toggleRow = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Bật/tắt TOÀN BỘ id đang hiện trên trang — tất cả đã chọn thì bỏ chọn hết, ngược lại chọn thêm cho đủ. */
  const toggleAllOnPage = useCallback((idsOnPage: number[]) => {
    setSelectedIds((prev) => {
      const allSelected = idsOnPage.length > 0 && idsOnPage.every((id) => prev.has(id))
      const next = new Set(prev)
      if (allSelected) idsOnPage.forEach((id) => next.delete(id))
      else idsOnPage.forEach((id) => next.add(id))
      return next
    })
  }, [])

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  return { selectedIds, toggleRow, toggleAllOnPage, clear }
}
