import type { OperatorType } from '../types'

/**
 * Hậu tố param cho từng operator: `<field>__<suffix>=<value>`.
 *
 * ⚠️ KHÁC bản FilterCN gốc — bảng này phải khớp `OPERATORS` trong
 * `backend/app/core/filter_operators.py`, sai một chữ là backend lặng lẽ bỏ qua
 * điều kiện (nó cố tình không raise để người dùng sửa tay URL không làm vỡ trang):
 *
 *   FilterCN gốc  ->  backend dự án
 *   (rỗng)            __eq          param TRẦN `status=abc` đã mang nghĩa LIKE %abc%
 *   __not             __ne
 *   __icontains       __contains
 *   __not_icontains   __not_contains
 *   __range           __between
 */
const OPERATOR_SUFFIX: Record<OperatorType, string> = {
  is: 'eq',
  is_not: 'ne',
  contains: 'contains',
  not_contains: 'not_contains',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  between: 'between',
  in: 'in',
  not_in: 'not_in',
  // Cả hai dùng chung hậu tố, phân biệt bằng giá trị true/false.
  is_empty: 'isnull',
  is_not_empty: 'isnull',
}

/** `("status", "contains")` -> `"status__contains"`. */
export function buildParamKey(field: string, operator: OperatorType): string {
  return `${field}__${OPERATOR_SUFFIX[operator]}`
}

/** Ánh xạ ngược hậu tố -> operator, dùng khi đọc bộ lọc từ URL. */
export function operatorFromSuffix(
  suffix: string,
  rawValue: string,
): OperatorType | null {
  if (suffix === 'isnull') {
    return rawValue.toLowerCase() === 'true' ? 'is_empty' : 'is_not_empty'
  }
  const entry = Object.entries(OPERATOR_SUFFIX).find(
    ([operator, value]) => value === suffix && operator !== 'is_empty' && operator !== 'is_not_empty',
  )
  return (entry?.[0] as OperatorType) ?? null
}
