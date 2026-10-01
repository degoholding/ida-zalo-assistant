import { useState } from 'react'

/**
 * `true` đúng một lượt render, ngay khi `signature` khác lượt render trước.
 *
 * Dùng để RESET state cục bộ theo một nguồn bên ngoài (prop `open` của hộp
 * thoại, dữ liệu vừa fetch về...) mà KHÔNG cần `useEffect`:
 *
 *   const openChanged = useHasChanged(open)
 *   if (openChanged) {
 *     setReason('')
 *     setFiles([])
 *   }
 *
 * Vì sao không dùng `useEffect(() => setX(...), [open])`:
 * effect chạy sau khi đã commit, nên người dùng thấy một khung hình với state
 * CŨ rồi mới thấy state mới — thừa một lượt render và đôi khi nháy dữ liệu cũ.
 * Gán state ngay trong lúc render là mẫu chính thức React khuyến nghị cho việc
 * này ("storing information from previous renders"): React hủy kết quả render
 * hiện tại và chạy lại component ngay, chưa commit ra DOM.
 *
 * So sánh bằng `Object.is`, nên truyền giá trị nguyên thủy hoặc một tham chiếu
 * ổn định (object từ React Query giữ nguyên identity tới khi dữ liệu đổi).
 * Cần so theo nội dung thì tự `JSON.stringify` trước khi truyền vào.
 */
export function useHasChanged(signature: unknown): boolean {
  const [previous, setPrevious] = useState(signature)

  if (!Object.is(previous, signature)) {
    setPrevious(signature)
    return true
  }

  return false
}
