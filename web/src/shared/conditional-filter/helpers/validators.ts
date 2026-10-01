import type { FilterRow } from '../types'

/** Dòng đã đủ thông tin để dịch thành một điều kiện gửi lên backend chưa. */
export function isValidFilterRow(row: FilterRow): boolean {
  if (!row.field || !row.operator) return false

  // "để trống" / "có giá trị" không cần ô giá trị.
  if (row.operator === 'is_empty' || row.operator === 'is_not_empty') return true

  if (row.operator === 'between') {
    if (!Array.isArray(row.value) || row.value.length !== 2) return false
    // Backend chấp nhận khoảng hở một đầu, nhưng hở CẢ HAI thì vô nghĩa.
    return row.value.some((bound) => bound !== null && bound !== '')
  }

  if (row.operator === 'in' || row.operator === 'not_in') {
    return Array.isArray(row.value) && row.value.length > 0
  }

  if (row.value === null || row.value === '') return false
  if (Array.isArray(row.value) && row.value.length === 0) return false

  return true
}

export function getValidFilterRows(rows: FilterRow[]): FilterRow[] {
  return rows.filter(isValidFilterRow)
}
