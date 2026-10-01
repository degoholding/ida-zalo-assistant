import { CONJUNCTION_PARAM } from '../constants'
import type { FilterConfig, FilterRow, FilterState, FilterValue } from '../types'
import { operatorFromSuffix } from './operators'
import { buildRestQuery } from './query-builder'

/**
 * State -> URLSearchParams. Chỉ sinh các param của bộ lọc; việc giữ lại `q`,
 * `page`… do `use-filter-url-sync.ts` lo.
 */
export function serializeFiltersToUrl(state: FilterState): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(buildRestQuery(state))) {
    params.set(key, value)
  }
  return params
}

/**
 * URL -> state. Param không nhận diện được (không có `__`, sai hậu tố, hoặc trỏ
 * tới trường không khai báo) bị bỏ qua chứ không ném lỗi — người dùng sửa tay
 * URL thì trang vẫn phải mở được.
 */
export function deserializeUrlToFilters(
  params: URLSearchParams,
  config: FilterConfig,
): FilterState {
  const rows: FilterRow[] = []

  for (const [key, rawValue] of params.entries()) {
    if (key === CONJUNCTION_PARAM || !key.includes('__')) continue

    // rpartition theo `__` — tên cột có thể tự chứa `__`, giống backend.
    const separator = key.lastIndexOf('__')
    const fieldName = key.slice(0, separator)
    const suffix = key.slice(separator + 2)

    const field = config.fields.find((item) => item.name === fieldName)
    if (!field) continue

    const operator = operatorFromSuffix(suffix, rawValue)
    if (!operator) continue

    rows.push({
      id: crypto.randomUUID(),
      field,
      operator,
      value: parseValue(operator, rawValue),
    })
  }

  return {
    rows,
    conjunction: params.get(CONJUNCTION_PARAM) === 'or' ? 'or' : 'and',
  }
}

function parseValue(operator: string, rawValue: string): FilterValue {
  if (operator === 'is_empty' || operator === 'is_not_empty') return null
  if (operator === 'between') {
    const [from = '', to = ''] = rawValue.split(',')
    return [from, to]
  }
  if (operator === 'in' || operator === 'not_in') {
    return rawValue.split(',').filter(Boolean)
  }
  return rawValue
}
