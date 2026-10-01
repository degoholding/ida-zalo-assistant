import { useSearchParams } from 'react-router-dom'

/**
 * Trạng thái sắp xếp của màn danh sách, giữ trên URL bằng cặp `sort_by` /
 * `sort_dir` — cùng khuôn với `CrudListPage` và các trang thu mua viết tay
 * (bao-CR-300, ticket 21). Trả về đúng bộ ba để cắm thẳng vào `DataTable`:
 *
 *   const { sortBy, sortDir, handleSortChange } = useUrlSort()
 *   <DataTable sortBy={sortBy} sortDir={sortDir} onSortChange={handleSortChange} />
 *
 * Trang tự lo phần gắn vào tham số API (bọc `if (sortBy)` rồi mới gắn
 * `sort_by`/`sort_dir` — khóa rỗng nghĩa là để backend xếp theo mặc định).
 */
export function useUrlSort() {
  const [searchParams, setSearchParams] = useSearchParams()

  const sortBy = searchParams.get('sort_by') || ''
  const sortDir = (searchParams.get('sort_dir') as 'asc' | 'desc') || 'asc'

  const handleSortChange = (newSortBy: string, newSortDir: 'asc' | 'desc') => {
    const next = new URLSearchParams(searchParams)
    //  Khóa cột rỗng = nhịp "thôi sắp xếp" của tiêu đề cột. Phải XÓA tham số
    //  chứ đừng ghi chuỗi rỗng, kẻo đường dẫn gửi cho nhau còn dính
    //  `?sort_by=&sort_dir=asc`, đọc như đang sắp xếp theo một cột không tên.
    if (newSortBy) {
      next.set('sort_by', newSortBy)
      next.set('sort_dir', newSortDir)
    } else {
      next.delete('sort_by')
      next.delete('sort_dir')
    }
    setSearchParams(next)
  }

  return { sortBy, sortDir, handleSortChange }
}
