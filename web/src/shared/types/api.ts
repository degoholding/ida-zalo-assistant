/** Kiểu dùng chung cho mọi lời gọi API. */

/** Danh sách có phân trang — backend trả `{ total, items }`. */
export interface PaginatedResult<T> {
  total: number
  items: T[]
}

/** Tham số phân trang + tìm kiếm chuẩn của mọi endpoint danh sách. */
export interface ListParams {
  page?: number
  page_size?: number
  /** Filter động: key phải nằm trong whitelist `filterable` của endpoint. */
  [key: string]: string | number | boolean | undefined
}

/** Bản ghi danh mục tối thiểu — đủ để đổ vào dropdown. */
export interface LookupOption {
  id: number
  code?: string
  name: string
}
