/**
 * Bộ lọc điều kiện — port từ FilterCN (`npx filtercn init`) sang React thuần.
 *
 * Ba khác biệt so với bản gốc, đều CÓ CHỦ Ý:
 *  1. Bản gốc viết cho Next.js (`next/navigation`); ở đây đồng bộ URL bằng
 *     react-router (`hooks/use-filter-url-sync.ts`).
 *  2. Hậu tố operator đổi cho khớp backend FastAPI của dự án — xem
 *     `helpers/operators.ts` và `backend/app/core/filter_operators.py`.
 *  3. Bỏ phụ thuộc `cmdk`: dùng danh sách tự cuộn thay cho Command. Ô ngày thì
 *     vẫn là `DatePicker` chung của hệ (react-day-picker) — xem `docs/ui/date.md`.
 */

// ===== ĐỊNH NGHĨA TRƯỜNG =====
export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'combobox'

export interface FilterFieldDefinition {
  /**
   * Khóa trường, cũng là tên cột trong query param.
   * ⚠️ PHẢI nằm trong whitelist `FILTERABLE` của controller tương ứng, nếu không
   * backend lặng lẽ bỏ qua điều kiện đó.
   */
  name: string
  /** Nhãn tiếng Việt hiện trên UI. */
  label: string
  type: FieldType
  /** Giới hạn operator cho trường này. Bỏ trống = lấy mặc định theo `type`. */
  operators?: OperatorType[]
  /** Options tĩnh cho select/multiselect. */
  options?: SelectOption[]
  /** Nạp options động cho combobox (nhận từ khóa tìm kiếm). */
  fetchOptions?: (search: string) => Promise<SelectOption[]>
}

// ===== OPERATOR =====
export type OperatorType =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty'

export interface SelectOption {
  label: string
  value: string
}

// ===== MỘT DÒNG ĐIỀU KIỆN (state lúc chạy) =====
export interface FilterRow {
  id: string
  field: FilterFieldDefinition | null
  operator: OperatorType | null
  value: FilterValue
}

export type FilterValue =
  | string
  | string[]
  | number
  | [number, number]
  | [string, string]
  | boolean
  | null

export interface FilterState {
  rows: FilterRow[]
  conjunction: 'and' | 'or'
}

/** Kết quả cuối: map param để ghép thẳng vào query string. */
export type RestQueryParams = Record<string, string>

export interface FilterConfig {
  fields: FilterFieldDefinition[]
  /** Cho đổi AND/OR. Backend đọc param `conjunction`. Mặc định: false. */
  allowConjunctionToggle?: boolean
  /** Số dòng điều kiện tối đa. Mặc định: 10. */
  maxRows?: number
  /**
   * Ghi bộ lọc lên URL để tải lại trang / chia sẻ link vẫn giữ nguyên.
   * Mặc định: true.
   */
  syncToUrl?: boolean
  /** Tên param tìm kiếm chung, được giữ lại khi ghi URL. Mặc định: `q`. */
  searchParamName?: string
  /** Các param KHÔNG do bộ lọc quản lý nhưng phải giữ lại trên URL. */
  preserveParams?: string[]
  locale?: Partial<FilterLocale>
}

export interface FilterLocale {
  addFilter: string
  reset: string
  apply: string
  placeholder: string
  and: string
  or: string
  noFilters: string
  filters: string
}
