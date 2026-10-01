import { useEffect, useState, type RefObject } from 'react'

export interface HorizontalOverflow {
  /** Còn nội dung bị khuất ở bên TRÁI (đã cuộn qua phải). */
  left: boolean
  /** Còn nội dung bị khuất ở bên PHẢI. */
  right: boolean
}

/**
 * Khung cuộn NGANG của `ref` đang khuất nội dung ở phía nào.
 *
 * Dùng để vẽ dải mờ ở mép bảng: bảng dòng chứng từ rộng 1350–3600px nằm trong
 * khung vài trăm pixel, và ở khổ điện thoại **thanh cuộn ngang không hiện** (iOS
 * và macOS mặc định ẩn thanh cuộn tới khi có thao tác). Kết quả là bảng chỉ cắt
 * chữ giữa chừng, không một dấu hiệu nào nói rằng bên phải còn cột — người dùng
 * đọc ra là "chữ bị lỗi" chứ không phải "vuốt sang đi". Khách báo đúng câu đó
 * ngày 14/09/2026 ở bảng dòng của phiếu yêu cầu mua hàng.
 *
 * ⚠️ **Phải theo dõi CẢ kích thước lẫn sự kiện cuộn.** Chỉ nghe `scroll` thì
 * lần vẽ đầu tiên không có sự kiện nào, dải mờ không xuất hiện cho tới khi người
 * dùng vuốt — tức đúng lúc cần gợi ý nhất thì nó im. Và số cột đổi được (menu
 * «Cột», nút «Bảng đầy đủ») nên `scrollWidth` đổi mà không có `scroll` lẫn
 * `resize` của khung: phải quan sát cả NÚT CON bên trong.
 *
 * ⚠️ Ngưỡng 1px chứ không phải 0: `scrollWidth` và `clientWidth` là số nguyên
 * làm tròn từ bề rộng thực có phần lẻ, nên một bảng vừa khít vẫn thường lệch 1.
 * Lấy mốc 0 thì dải mờ bên phải hiện vĩnh viễn trên bảng không hề tràn.
 */
export function useHorizontalOverflow(
  ref: RefObject<HTMLElement | null>,
): HorizontalOverflow {
  const [state, setState] = useState<HorizontalOverflow>({ left: false, right: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const read = () => {
      const max = el.scrollWidth - el.clientWidth
      setState((prev) => {
        const next = { left: el.scrollLeft > 1, right: max > 1 && el.scrollLeft < max - 1 }
        //  So rồi mới ghi: `scroll` bắn hàng chục lần một cú vuốt, mà trong đó
        //  chỉ hai lần thực sự đổi trạng thái. Trả về `prev` để React bỏ qua
        //  lượt vẽ lại.
        return prev.left === next.left && prev.right === next.right ? prev : next
      })
    }

    read()
    el.addEventListener('scroll', read, { passive: true })

    //  Quan sát cả khung LẪN nút con: khung đổi bề rộng khi xoay máy hoặc mở
    //  thanh bên, còn nút con đổi khi bật/tắt cột.
    const observer = new ResizeObserver(read)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)

    return () => {
      el.removeEventListener('scroll', read)
      observer.disconnect()
    }
  }, [ref])

  return state
}
