import { Checkbox } from '@/shared/ui/checkbox'
import type { DataTableColumn } from './types'

export interface SelectionColumnOptions<T> {
  /** Lấy ID số từ một dòng — bảng nào cũng có khóa số (`row.id`). */
  getRowId: (row: T) => number
  selectedIds: Set<number>
  onToggleRow: (id: number) => void
  onToggleAllOnPage: () => void
  allOnPageSelected: boolean
  someOnPageSelected: boolean
  /** Tên hiện trong `aria-label` của ô tick từng dòng — bỏ trống thì dùng ID. */
  getRowLabel?: (row: T) => string
}

/**
 * Cột «Chọn» (tick nhiều dòng cho thao tác HÀNG LOẠT) — dùng chung cho mọi
 * `DataTable`, tách khỏi nơi dùng đầu tiên (`folder-document-columns.tsx`,
 * phase 05) để màn Văn bản (phase 06, `outgoing-documents-tab.tsx`) dùng lại
 * đúng một bản thay vì chép JSX checkbox lần hai.
 *
 * Không phải hook: đây là một hàm factory THUẦN trả về khai báo cột, gọi được
 * ngay bên trong `useMemo` của nơi dùng — logic chọn/bỏ chọn thật nằm ở
 * `useRowSelection` (`@/shared/hooks/use-row-selection`).
 */
export function createSelectionColumn<T>({
  getRowId,
  selectedIds,
  onToggleRow,
  onToggleAllOnPage,
  allOnPageSelected,
  someOnPageSelected,
  getRowLabel,
}: SelectionColumnOptions<T>): DataTableColumn<T> {
  return {
    key: 'select',
    header: 'Chọn',
    width: 52,
    minWidth: 44,
    align: 'center',
    hideable: false,
    defaultPinned: true,
    headerContent: (
      <Checkbox
        checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
        aria-label={allOnPageSelected ? 'Bỏ chọn cả trang' : 'Chọn cả trang'}
        onCheckedChange={onToggleAllOnPage}
      />
    ),
    cell: (row) => {
      const id = getRowId(row)
      return (
        //  Chặn nổi bọt lên `onRowClick` của bảng (mở trang chi tiết) — tick
        //  chọn không phải điều hướng.
        <span className="flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={selectedIds.has(id)}
            aria-label={getRowLabel ? `Chọn ${getRowLabel(row)}` : `Chọn dòng ${id}`}
            onCheckedChange={() => onToggleRow(id)}
          />
        </span>
      )
    },
  }
}
