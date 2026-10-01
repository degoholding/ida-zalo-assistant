import type { FieldType, FilterLocale, OperatorType } from './types'

export const DEFAULT_LOCALE: FilterLocale = {
  addFilter: '+ Thêm điều kiện',
  reset: 'Xóa hết',
  apply: 'Áp dụng',
  placeholder: 'Chọn…',
  and: 'VÀ',
  or: 'HOẶC',
  noFilters: 'Chưa có điều kiện nào',
  filters: 'Bộ lọc',
}

/** Operator hợp lệ theo từng kiểu trường. */
export const DEFAULT_OPERATORS: Record<FieldType, OperatorType[]> = {
  text: ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty'],
  number: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  multiselect: ['in', 'not_in', 'is_empty', 'is_not_empty'],
  date: ['is', 'gte', 'lte', 'between', 'is_empty', 'is_not_empty'],
  datetime: ['is', 'gte', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['is'],
  combobox: ['is', 'is_not', 'is_empty', 'is_not_empty'],
}

/** Nhãn tiếng Việt của operator. */
export const OPERATOR_LABELS: Record<OperatorType, string> = {
  is: 'bằng',
  is_not: 'khác',
  contains: 'chứa',
  not_contains: 'không chứa',
  gt: 'lớn hơn',
  gte: 'từ',
  lt: 'nhỏ hơn',
  lte: 'đến',
  between: 'trong khoảng',
  in: 'thuộc danh sách',
  not_in: 'không thuộc danh sách',
  is_empty: 'để trống',
  is_not_empty: 'có giá trị',
}

/** Param báo backend nối các điều kiện bằng OR thay vì AND. */
export const CONJUNCTION_PARAM = 'conjunction'
