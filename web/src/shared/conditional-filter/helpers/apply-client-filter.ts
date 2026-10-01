import { getValidFilterRows } from './validators'
import type { FilterRow, FilterState } from '../types'

/**
 * Áp BỘ LỌC NÂNG CAO ngay tại trình duyệt.
 *
 * Dùng cho những màn đã nạp sẵn CẢ danh sách: danh mục nền dưới vài trăm dòng,
 * hoặc màn mà backend không nhận tham số lọc (`/api/documents/applies-to-me`
 * tính phạm vi bằng vòng lặp Python nên không lọc thêm được ở tầng truy vấn).
 *
 * Màn nào gọi API có phân trang thì **đừng dùng hàm này** — dùng `useFilterQuery`
 * để dịch bộ lọc thành query param và để backend lọc
 * (`backend/app/core/filter_operators.py`). Lọc ở client trên dữ liệu đã phân
 * trang chỉ lọc được đúng trang đang xem, tức là ra kết quả sai.
 */
export function applyClientFilter<T>(items: T[], state: FilterState): T[] {
  const rows = getValidFilterRows(state.rows)
  if (rows.length === 0) return items

  return items.filter((item) =>
    state.conjunction === 'or'
      ? rows.some((row) => matchesRow(item, row))
      : rows.every((row) => matchesRow(item, row)),
  )
}

/**
 * Điều kiện không đánh giá được thì LOẠI dòng đó, không phải cho lọt.
 *
 * Cho lọt là người dùng tưởng mình đã lọc mà thật ra đang nhìn nguyên danh
 * sách — sai mà không có dấu hiệu gì. Loại hết thì bảng trống, nhìn ra ngay.
 */
const NOT_RATED = false

function matchesRow<T>(item: T, row: FilterRow): boolean {
  const raw = (item as Record<string, unknown>)[row.field?.name ?? '']

  //  Rỗng/không rỗng xét trước và xét chung cho mọi kiểu: `0` và `false` là có
  //  giá trị, chỉ `null`, `undefined` và chuỗi rỗng mới là để trống.
  const isEmpty = raw === null || raw === undefined || raw === ''
  if (row.operator === 'is_empty') return isEmpty
  if (row.operator === 'is_not_empty') return !isEmpty

  switch (row.field?.type) {
    case 'boolean':
      return Boolean(raw) === (row.value === true || row.value === 'true')
    case 'number':
      return matchesNumber(Number(raw), row)
    case 'date':
    case 'datetime':
      return matchesDate(toDateOnly(raw), row)
    default:
      return matchesText(String(raw ?? '').toLowerCase(), row)
  }
}

/** Cắt còn `YYYY-MM-DD` để mốc ngày so được với cả giá trị có kèm giờ. */
function toDateOnly(value: unknown): string {
  return String(value ?? '').slice(0, 10)
}

function matchesText(text: string, row: FilterRow): boolean {
  const value = typeof row.value === 'string' ? row.value.toLowerCase() : row.value

  switch (row.operator) {
    case 'is':
      return text === value
    case 'is_not':
      return text !== value
    case 'contains':
      return text.includes(String(value).toLowerCase())
    case 'not_contains':
      return !text.includes(String(value).toLowerCase())
    case 'in':
      return toLowerList(row.value).includes(text)
    case 'not_in':
      return !toLowerList(row.value).includes(text)
    default:
      return NOT_RATED
  }
}

function matchesNumber(value: number, row: FilterRow): boolean {
  if (Number.isNaN(value)) return false

  if (row.operator === 'between') {
    //  `isValidFilterRow` chấp nhận khoảng HỞ MỘT ĐẦU, nên đầu bỏ trống phải
    //  thành vô cực chứ không thành `NaN` — không thì "từ 5 trở lên" ra rỗng.
    const [from, to] = toRange(row.value)
    return value >= (from === '' ? -Infinity : Number(from))
      && value <= (to === '' ? Infinity : Number(to))
  }

  const threshold = Number(row.value)
  if (Number.isNaN(threshold)) return false

  return compare(value, threshold, row)
}

function matchesDate(value: string, row: FilterRow): boolean {
  //  Không có ngày thì mọi phép so sánh đều vô nghĩa — trả `false` chứ đừng coi
  //  như lọt, không thì dòng trống ngày nằm lẫn trong kết quả "từ ngày X".
  if (!value) return false

  if (row.operator === 'between') {
    //  Hở một đầu là hợp lệ (xem `isValidFilterRow`): bỏ trống đầu nào thì
    //  không ràng buộc đầu đó.
    const [from, to] = toRange(row.value)
    return (from === '' || value >= toDateOnly(from)) && (to === '' || value <= toDateOnly(to))
  }

  //  Ngày lưu dạng ISO nên so sánh chuỗi cũng là so đúng thứ tự thời gian.
  return compare(value, toDateOnly(row.value), row)
}

/** Phần so sánh có thứ tự, dùng chung cho số và ngày. */
function compare<V extends number | string>(value: V, threshold: V, row: FilterRow): boolean {
  switch (row.operator) {
    case 'is':
      return value === threshold
    case 'is_not':
      return value !== threshold
    case 'gt':
      return value > threshold
    case 'gte':
      return value >= threshold
    case 'lt':
      return value < threshold
    case 'lte':
      return value <= threshold
    default:
      return NOT_RATED
  }
}

/** Hai đầu của khoảng, đầu bỏ trống trả về chuỗi rỗng. */
function toRange(value: FilterRow['value']): [string, string] {
  if (!Array.isArray(value)) return ['', '']
  const [from, to] = value
  return [from ?? '', to ?? ''].map(String) as [string, string]
}

function toLowerList(value: FilterRow['value']): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).toLowerCase()) : []
}
