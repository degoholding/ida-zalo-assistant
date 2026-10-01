import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Tách chuỗi nối bằng dấu phẩy trên URL thành danh sách giá trị.
 *
 * Cắt khoảng trắng, bỏ phần rỗng và khử trùng nhưng GIỮ THỨ TỰ người dùng đã
 * chọn — cùng luật với `read_multi_param` bên backend (bao-CR-423), để hai bên
 * không bao giờ hiểu khác nhau về cùng một đường dẫn.
 */
export function splitMultiValue(raw: string): string[] {
  const out: string[] = []
  for (const piece of raw.split(',')) {
    const value = piece.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/**
 * Một ô lọc CHỌN NHIỀU giá trị lấy URL làm nguồn sự thật (bao-CR-423).
 *
 * Trên URL vẫn là MỘT tham số nối bằng dấu phẩy (`?status=dang_xu_ly,hoan_tat`)
 * chứ không lặp khóa: link ngắn, và backend đọc được cả hai kiểu nên không phải
 * đổi gì thêm. Không chọn gì = không có tham số = "Tất cả", đúng nết của ô lọc
 * — đừng bịa thêm một giá trị "tất cả" nào nữa.
 *
 * ⚠️ Param nào dùng ở đây PHẢI khai trong `preserveParams` của `FilterProvider`
 * trên cùng trang, nếu không lần bấm "Áp dụng" bộ lọc nâng cao sẽ quét sạch nó.
 */
export function useUrlMultiParam(name: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(name) ?? ''

  //  Giữ NGUYÊN mảng khi chuỗi trên URL không đổi: mảng mới mỗi lần render sẽ
  //  làm mọi `useMemo`/`useEffect` phía dưới chạy lại vô cớ.
  const value = useMemo(() => splitMultiValue(raw), [raw])

  const setValue = useCallback(
    (next: string[]) => {
      const joined = next.join(',')
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (joined) params.set(name, joined)
          else params.delete(name)
          return params
        },
        // `replace`: đổi bộ lọc năm lần rồi bấm Back thì người dùng mong quay
        // lại TRANG TRƯỚC, không phải lùi qua từng lần tick.
        { replace: true },
      )
    },
    [name, setSearchParams],
  )

  return [value, setValue] as const
}
