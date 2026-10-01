/**
 * Bảng danh sách dùng chung: ẩn/hiện cột, kéo giãn cột, kéo thả đổi thứ tự
 * cột, phân trang. Khai `storageKey` thì cả ba thứ đó được nhớ giữa các phiên.
 *
 *   const columns: DataTableColumn<Employee>[] = [
 *     { key: 'code', header: 'Mã NV', width: 130, cell: (r) => r.code },
 *     { key: 'full_name', header: 'Họ tên', hideable: false, cell: (r) => r.full_name },
 *   ]
 *
 *   <DataTable
 *     columns={columns}
 *     rows={data?.items}
 *     getRowId={(row) => row.id}
 *     storageKey="hr.employees"
 *     pagination={{ page, pageSize, total, onPageChange, onPageSizeChange, unitLabel: 'nhân sự' }}
 *   />
 */
export { DataTable, type DataTableProps } from './data-table'
export { PAGE_SIZE_OPTIONS } from './data-table-pagination'
export { FilterResetButton, type FilterResetButtonProps } from './filter-reset-button'
export { createSelectionColumn, type SelectionColumnOptions } from './selection-column'
export type { DataTableColumn, DataTablePagination } from './types'
