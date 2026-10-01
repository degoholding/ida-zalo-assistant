import { useCallback, useRef } from 'react'

/**
 * Cho phép ĐÚNG MỘT lượt chạy tại một thời điểm — bấm thêm trong lúc đang chạy
 * thì bỏ qua, không xếp hàng.
 *
 * ⚠️ **`disabled={mutation.isPending}` KHÔNG đủ.** `isPending` là state của
 * React, chỉ bật sau khi component render lại; ba cú bấm trong cùng một nhịp
 * (người dùng sốt ruột nhấp nhấp, hoặc chuột đúp) đều lọt qua trước lần render
 * đó. Đo được ngày 04/09/2026 ở trang *Thêm loại nghỉ*: một lần bấm ba lần ra
 * **ba lệnh POST** — bản ghi chỉ tạo một (ràng buộc duy nhất ở DB đỡ hộ) nhưng
 * người dùng nhận một toast xanh rồi hai toast đỏ báo lỗi hệ thống. Với danh mục
 * KHÔNG có cột duy nhất thì đó là ba bản ghi trùng.
 *
 * `useRef` vì nó đổi NGAY trong cùng nhịp, không đợi render.
 */
export function useSingleFlight() {
  const running = useRef(false)

  return useCallback(async (task: () => unknown | Promise<unknown>) => {
    if (running.current) return
    running.current = true
    try {
      await task()
    } finally {
      running.current = false
    }
  }, [])
}
