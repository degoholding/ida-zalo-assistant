import { useMemo } from 'react'

import { buildRestQuery } from '../helpers/query-builder'
import { useOptionalFilterContext } from '../provider/filter-context'

/**
 * Query param của bộ lọc ĐÃ ÁP DỤNG — đổ thẳng vào hook danh sách:
 *
 *   const { queryParams } = useFilterQuery()
 *   const { data } = useEmployees({ page, ...queryParams })
 *
 * Object trả về được memo hóa theo nội dung nên dùng làm dependency của
 * `useEffect` (vd reset về trang 1) mà không sợ vòng lặp render.
 */
export function useFilterQuery() {
  const context = useOptionalFilterContext()

  const appliedState = context?.appliedState
  const activeCount = context?.activeCount ?? 0

  const queryParams = useMemo(
    () => (appliedState ? buildRestQuery(appliedState) : {}),
    [appliedState],
  )

  /** Chuỗi ổn định để so sánh — object mới mỗi lần memo chạy lại. */
  const queryKey = useMemo(() => JSON.stringify(queryParams), [queryParams])

  return { queryParams, queryKey, activeCount }
}

