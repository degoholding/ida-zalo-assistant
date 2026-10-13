/** Loại dòng danh mục — khớp `CatalogKind` ở `src/constants.ts`; đổi bên đó thì sửa tay bên này. */
export const CATALOG_KIND = { staff: 1, dealer: 2 } as const

/** Tình trạng khớp với liên hệ Zalo — khớp `CatalogMatchStatus` ở `src/constants.ts`. */
export const CATALOG_MATCH_STATUS = { unmatched: 0, matched: 1, suggested: 2, confirmed: 3, unlinked: 4 } as const

export const CATALOG_KIND_OPTIONS = [
  { value: CATALOG_KIND.staff, label: 'Nhân viên' },
  { value: CATALOG_KIND.dealer, label: 'Đại lý' },
]

export const CATALOG_MATCH_STATUS_OPTIONS = [
  { value: CATALOG_MATCH_STATUS.unmatched, label: 'Chưa khớp' },
  { value: CATALOG_MATCH_STATUS.matched, label: 'Đã khớp' },
  { value: CATALOG_MATCH_STATUS.suggested, label: 'Gợi ý, chờ xác nhận' },
  { value: CATALOG_MATCH_STATUS.confirmed, label: 'Đã xác nhận' },
  //  Quản trị đã «Bỏ gắn» — khớp lại / nạp tệp không tự gắn nữa, chỉ gắn khi chọn tay (hoặc tệp đổi SĐT)
  { value: CATALOG_MATCH_STATUS.unlinked, label: 'Đã bỏ gắn' },
]

/** Một dòng danh mục như `GET /api/catalog` / `GET /api/catalog/:id` trả về (`src/web/api/catalog-api.ts`). */
export interface CatalogEntry {
  [key: string]: unknown
  id: number
  kind: number
  code: string
  name: string
  phone: string
  region: string
  sales_zone: string
  owner_code: string
  owner_entry_id: number | null
  owner_name: string | null
  /** Chức danh, email, cấp, địa chỉ, ghi chú — chỉ có ô nào có chữ. */
  extra: Record<string, string>
  is_active: boolean
  expects_report: boolean
  contact_id: number | null
  contact_name: string | null
  contact_avatar_url: string | null
  match_status: number
  imported_at: string | null
  updated_at: string
}

/** Ứng viên khớp của một dòng `Suggested` (chỉ ở chi tiết). */
export interface CatalogCandidate {
  contact_id: number
  name: string
  kind: number
  phone: string
  score: number
  avatar_url: string | null
  /** Tên mục danh mục khác đang giữ liên hệ này (không chọn được cho đến khi bỏ gắn). */
  linked_entry_name: string | null
}

export interface CatalogEntryDetail extends CatalogEntry {
  candidates: CatalogCandidate[]
}

/** Tóm tắt lần nạp — khớp `CatalogImportSummary` ở `src/catalog/catalog-types.ts`. */
export interface CatalogImportSummary {
  created: number
  updated: number
  matched: number
  suggested: number
  unmatched: number
  errors: string[]
}

export type CatalogActionRequest = { action: 'confirm'; contact_id: number } | { action: 'unlink' }

export function getCatalogKindLabel(kind: number): string {
  return CATALOG_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? ''
}

export function getCatalogMatchStatusLabel(status: number): string {
  return CATALOG_MATCH_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? ''
}
