import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Một KHOẢNG (từ – đến) lấy URL làm nguồn sự thật. Cùng họ với
 * `useUrlParamState`, khác ở chỗ ghi **hai** tham số trong MỘT lần gọi
 * `setSearchParams`.
 *
 * ⚠️ Vì sao không dùng hai `useUrlParamState` rồi gọi liên tiếp: mỗi lần gọi
 * `setSearchParams` đều dựng bản mới từ `searchParams` của LẦN VẼ hiện tại, mà
 * hai lệnh trong cùng một hàm xử lý thì chưa vẽ lại giữa chừng. Lệnh sau đọc
 * đúng bản cũ, ghi đè lệnh trước, và tham số thứ nhất bốc hơi — chọn khoảng
 * ngày xong chỉ còn `?date_to=`.
 *
 * Giá trị rỗng thì XÓA khỏi URL (link sạch). Param dùng ở đây PHẢI khai trong
 * `preserveParams` của `FilterProvider` trên cùng trang, nếu không lần bấm
 * "Áp dụng" bộ lọc nâng cao sẽ quét sạch nó.
 */
export function useUrlRangeParam(fromName: string, toName: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const from = searchParams.get(fromName) ?? ''
  const to = searchParams.get(toName) ?? ''

  const setRange = useCallback(
    (nextFrom: string, nextTo: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          if (nextFrom) params.set(fromName, nextFrom)
          else params.delete(fromName)
          if (nextTo) params.set(toName, nextTo)
          else params.delete(toName)
          return params
        },
        // `replace`: đổi khoảng ngày mấy lần rồi bấm Back thì người dùng mong
        // quay lại TRANG TRƯỚC, không phải lùi qua từng lần chọn.
        { replace: true },
      )
    },
    [fromName, toName, setSearchParams],
  )

  return [from, to, setRange] as const
}
