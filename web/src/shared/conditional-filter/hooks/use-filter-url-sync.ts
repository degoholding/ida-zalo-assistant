import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import { deserializeUrlToFilters, serializeFiltersToUrl } from '../helpers/serializer'
import { getValidFilterRows } from '../helpers/validators'
import type { FilterConfig, FilterState } from '../types'

/**
 * Đồng bộ bộ lọc với query string.
 *
 * Đây là chỗ thay thế `next/navigation` của FilterCN gốc bằng react-router.
 * `replace` chứ không `push`: đổi bộ lọc năm lần rồi bấm Back thì người dùng
 * mong quay lại TRANG TRƯỚC, không phải lùi qua từng lần lọc.
 */
export function useFilterUrlSync(config: FilterConfig) {
  const [searchParams, setSearchParams] = useSearchParams()
  const enabled = config.syncToUrl !== false

  // Chỉ đọc URL một lần lúc khởi tạo. Đọc liên tục sẽ dựng lại dòng điều kiện
  // (kèm id mới) ngay giữa lúc người dùng đang gõ.
  const initialParams = useRef(searchParams)
  const initialState = useMemo(
    () =>
      enabled
        ? // Đọc ref lúc render là CỐ Ý: chỉ lấy URL của lần khởi tạo (xem chú thích trên).
          // eslint-disable-next-line react-hooks/refs
          deserializeUrlToFilters(initialParams.current, config)
        : { rows: [], conjunction: 'and' as const },
    // Cố ý chỉ chạy một lần: `config` là object dựng lại mỗi lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled],
  )

  const applyChanges = useCallback(
    (nextState: FilterState) => {
      if (!enabled) return

      const filterParams = serializeFiltersToUrl({
        ...nextState,
        rows: getValidFilterRows(nextState.rows),
      })

      setSearchParams(
        (current) => {
          // Giữ lại param KHÔNG thuộc bộ lọc (ô tìm kiếm, tab đang mở…).
          const keep = [config.searchParamName ?? 'q', ...(config.preserveParams ?? [])]
          for (const name of keep) {
            const value = current.get(name)
            if (value) filterParams.set(name, value)
          }
          return filterParams
        },
        { replace: true },
      )
    },
    [enabled, config.searchParamName, config.preserveParams, setSearchParams],
  )

  return { initialState, applyChanges }
}
