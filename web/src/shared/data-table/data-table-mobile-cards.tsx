import type { ReactNode } from 'react'

import { Skeleton } from '@/shared/ui/skeleton'
import { cn } from '@/shared/utils/cn'

interface DataTableMobileCardsProps<T> {
  rows: T[] | undefined
  getRowId: (row: T) => string | number
  /** Nội dung một thẻ — do màn gọi dựng, xem `DataTableProps.mobileCard`. */
  renderCard: (row: T) => ReactNode
  isLoading?: boolean
  isError?: boolean
  emptyMessage: string
  errorMessage: string
  onRowClick?: (row: T) => void
  fillHeight?: boolean
}

/**
 * Danh sách THẺ thay cho bảng khi màn hình hẹp — xem `DataTableProps.mobileCard`.
 *
 * ⚠️ **Vì sao không co bảng lại cho vừa mà phải đổi hẳn hình dạng.** Bảng ở đây
 * `table-fixed` và mỗi cột khai bề rộng cứng, nên bề rộng tự nhiên của nó
 * ~1000px. Trên máy 393px, phần nhìn thấy được là **hai cột đầu** — muốn biết
 * người ta nghỉ ngày nào thì phải cuộn ngang, mà cuộn ngang xong lại mất cột tên
 * (chỉ cột ghim còn lại, ăn thêm 110px của 393px vốn đã chật). Rút bớt cột cũng
 * không cứu được: ba cột vẫn là 330px, và bỏ cột nghĩa là bỏ dữ liệu. Thẻ thì
 * xếp DỌC — mọi trường của một bản ghi nằm trong tầm mắt, không thao tác nào
 * phải cuộn ngang.
 *
 * ⚠️ **Thẻ bấm được phải là `<button>` thật.** `div` + `onClick` thì bàn phím và
 * trình đọc màn hình không tới được, mà đây là đường DUY NHẤT vào chi tiết đơn
 * ở chế độ này (bảng còn có nhiều cột để dò, thẻ thì chỉ có một vùng bấm).
 *
 * ⚠️ **`text-left` là bắt buộc**: `<button>` mặc định canh giữa chữ, thiếu nó
 * thì mọi dòng trong thẻ dồn vào giữa và cả danh sách đọc như một dãy nút.
 */
export function DataTableMobileCards<T>({
  rows,
  getRowId,
  renderCard,
  isLoading,
  isError,
  emptyMessage,
  errorMessage,
  onRowClick,
  fillHeight,
}: DataTableMobileCardsProps<T>) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        //  Cuộn nằm ở ĐÂY chứ không ở cả trang: thanh công cụ (ô tìm, bộ lọc)
        //  và phân trang phải đứng yên, nếu không thì lọc lại một phát là phải
        //  cuộn ngược lên đầu mới thấy ô tìm.
        fillHeight && 'flex min-h-0 flex-1 flex-col',
      )}
    >
      <div className={cn('divide-y', fillHeight && 'min-h-0 flex-1 overflow-y-auto')}>
        {isLoading &&
          Array.from({ length: 4 }).map((_, index) => (
            <div key={`skeleton-${index}`} className="space-y-2 p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}

        {!isLoading && isError && (
          <p className="px-4 py-8 text-center text-sm text-destructive">{errorMessage}</p>
        )}

        {!isLoading && !isError && rows?.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        )}

        {!isLoading &&
          !isError &&
          rows?.map((row) =>
            onRowClick ? (
              <button
                key={getRowId(row)}
                type="button"
                onClick={() => onRowClick(row)}
                className="block w-full p-3 text-left transition-colors active:bg-row-hover"
              >
                {renderCard(row)}
              </button>
            ) : (
              <div key={getRowId(row)} className="p-3">
                {renderCard(row)}
              </div>
            ),
          )}
      </div>
    </div>
  )
}
