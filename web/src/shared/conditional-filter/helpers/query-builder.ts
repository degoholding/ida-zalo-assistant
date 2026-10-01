import { CONJUNCTION_PARAM } from '../constants'
import type { FilterRow, FilterState, RestQueryParams } from '../types'
import { buildParamKey } from './operators'
import { getValidFilterRows } from './validators'

/**
 * Dịch các dòng điều kiện thành query param cho backend.
 * Dòng chưa hợp lệ bị bỏ qua — người dùng đang gõ dở không nên làm hỏng danh sách.
 */
export function buildRestQuery(state: FilterState): RestQueryParams {
  const params: RestQueryParams = {}

  for (const row of getValidFilterRows(state.rows)) {
    if (!row.field || !row.operator) continue
    params[buildParamKey(row.field.name, row.operator)] = serializeValue(row)
  }

  // Chỉ gửi khi là OR — backend mặc định AND, thêm param thừa chỉ làm bẩn URL.
  if (state.conjunction === 'or' && Object.keys(params).length > 1) {
    params[CONJUNCTION_PARAM] = 'or'
  }

  return params
}

function serializeValue(row: FilterRow): string {
  // `__isnull=true` = để trống, `false` = có giá trị.
  if (row.operator === 'is_empty') return 'true'
  if (row.operator === 'is_not_empty') return 'false'

  // Backend tách `between` và `in` bằng dấu phẩy (xem `_split_list` / `build_condition`).
  if (Array.isArray(row.value)) {
    return row.value.map((item) => String(item ?? '')).join(',')
  }

  return String(row.value)
}
