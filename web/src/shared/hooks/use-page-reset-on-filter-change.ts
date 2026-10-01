import { useState, type Dispatch, type SetStateAction } from 'react'

import { useHasChanged } from './use-has-changed'

/**
 * State `page` cho màn hình danh sách, TỰ VỀ 1 khi bất kỳ điều kiện lọc nào đổi.
 *
 * Đổi bộ lọc mà giữ nguyên số trang thì hay rơi vào trang trống — kết quả mới
 * thường ít hơn trang đang đứng.
 *
 * Vì sao không dùng `useEffect(() => setPage(1), [deps])`:
 * effect chỉ chạy SAU khi render xong và đã commit, nên lượt render đầu tiên
 * sau khi đổi bộ lọc vẫn gọi API với `page` cũ → tốn một request thừa vào trang
 * không còn tồn tại, rồi mới render lại lần nữa với `page = 1`.
 *
 * Ở đây so ngay trong lúc render theo đúng mẫu chính thức của React
 * ("storing information from previous renders"): khi phát hiện bộ lọc đổi,
 * React hủy kết quả render hiện tại và chạy lại component ngay lập tức với
 * `page = 1` — chưa commit ra DOM và chưa chạy effect nào, nên không có
 * request thừa.
 *
 *   const [page, setPage] = usePageResetOnFilterChange([queryKey, debouncedValue, status])
 *
 * @param filterDeps Danh sách giá trị lọc. So sánh bằng `JSON.stringify` nên
 *   truyền giá trị nguyên thủy hoặc chuỗi đã ổn định (vd `queryKey` của
 *   `useFilterQuery`), đừng truyền object tạo mới mỗi lần render.
 */
export function usePageResetOnFilterChange(
  filterDeps: readonly unknown[],
): [number, Dispatch<SetStateAction<number>>] {
  const [page, setPage] = useState(1)

  // `JSON.stringify` để so theo NỘI DUNG: mảng deps là mảng mới mỗi lần render.
  if (useHasChanged(JSON.stringify(filterDeps))) {
    setPage(1)
  }

  return [page, setPage]
}
