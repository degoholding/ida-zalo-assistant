import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { PAGE_ELLIPSIS, getPageItems } from './page-range'
import type { DataTablePagination as PaginationProps } from './types'

/** Số dòng/trang cho người dùng chọn. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

/** Cỡ trang NHỎ NHẤT chọn được — mốc để biết ô chọn số dòng còn nghĩa lý gì không. */
const SMALLEST_PAGE_SIZE = Math.min(...PAGE_SIZE_OPTIONS)

/**
 * Chân bảng: bên TRÁI chọn số dòng mỗi trang + tổng số bản ghi,
 * bên PHẢI là dãy nút số trang kèm lùi/tiến.
 *
 * ⚠️ **Hai cụm đó tự biến mất khi chúng không điều khiển được gì** — cùng luật
 * với `ColumnVisibilityMenu` (bảng ở chế độ thẻ thì không có cột nào để ẩn/hiện
 * nên menu không dựng). Nhưng chúng **chết theo hai điều kiện KHÁC NHAU**, và
 * gộp lại là đẻ ra một cái bẫy — xem ba chỗ kiểm tra ngay dưới.
 */
export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  unitLabel,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const pageItems = getPageItems(page, pageCount)

  //  ⚠️ Bảng RỖNG thì chân bảng IM HẲN. Câu «bảng trống» ngay phía trên đã nói
  //  đủ — và nói rõ hơn, vì nó phân biệt được *rỗng vì bộ lọc* với *rỗng vì
  //  chưa có gì*. Thêm dòng «Tổng 0 …» bên dưới chỉ là nói lại cùng điều bằng
  //  giọng máy móc hơn, kèm ba nút bấm không đi đâu được.
  if (total === 0) return null

  //  ⚠️ **VỪA ĐÚNG MỘT TRANG = dãy nút số trang đã chết.** Hai nút lùi/tiến đều
  //  xám, nút «1» bấm vào vẫn đứng nguyên chỗ cũ. Đo ở tab «Người đang giữ» của
  //  một chức vụ chỉ MỘT người (báo 10/09/2026): chân bảng ăn ~100px trong khi
  //  phần đáng đọc cao 65px.
  const showPageButtons = pageCount > 1

  //  ⚠️ **Ô CHỌN SỐ DÒNG CHẾT THEO ĐIỀU KIỆN KHÁC — đừng gộp vào điều kiện
  //  trên.** Gộp thì sinh ra đúng cái bẫy «nút hoàn tác biến mất vì chính lựa
  //  chọn cần hoàn tác»: người dùng chọn *100 dòng/trang* trên một danh sách 80
  //  dòng → còn một trang → ô chọn biến mất → **không có đường nào quay về 20
  //  dòng/trang nữa**, kẹt với một trang cuộn dài 80 thẻ. Cùng họ với luật ở
  //  thanh công cụ tab «Người đang giữ»: đang lọc thì ô lọc phải ở lại.
  //
  //  Mốc đúng là *"có lựa chọn nào chia nổi danh sách này thành hai trang
  //  không"* — tức so với cỡ trang NHỎ NHẤT, không so với cỡ trang đang dùng.
  //  Dưới mốc đó thì mọi lựa chọn cho ra cùng một màn hình, lúc ấy nó mới thật
  //  sự không điều khiển gì.
  const showPageSize = total > SMALLEST_PAGE_SIZE

  //  Không còn gì để bấm thì chỉ giữ con số tổng — thứ duy nhất ở đây là THÔNG
  //  TIN chứ không phải nút.
  if (!showPageButtons && !showPageSize) {
    return (
      <div className="mt-3 shrink-0 text-sm text-muted-foreground">
        Tổng {total.toLocaleString('vi-VN')} {unitLabel}
      </div>
    )
  }

  return (
    // Không kẻ `border-t`: bảng phía trên đã có khung viền riêng, thêm vạch nữa
    // là thành hai đường sát nhau. `shrink-0` để khi bảng fit chiều cao thì
    // thanh này không bị bóp lại.
    <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {!showPageSize ? (
          <span>
            Tổng {total.toLocaleString('vi-VN')} {unitLabel}
          </span>
        ) : (
          <>
            <span>Hiển thị</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                onPageSizeChange(Number(value))
                // Đổi cỡ trang thì số trang đổi theo; đang ở trang 7 mà chuyển
                // sang 100 dòng/trang là rơi vào vùng trống.
                onPageChange(1)
              }}
            >
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              dòng · Tổng {total.toLocaleString('vi-VN')} {unitLabel}
            </span>
          </>
        )}
      </div>

      {/*  ⚠️ Khổ hẹp: dãy nút **rớt xuống hàng riêng và phải BÁM MÉP PHẢI**.
           `justify-between` của khối cha chỉ chia chỗ trong PHẠM VI MỘT HÀNG —
           hàng thứ hai chỉ có một phần tử nên nó rơi về mép trái, tức dãy nút
           đổi bên tuỳ theo nó có xuống dòng hay không. `w-full` + `justify-end`
           giữ nó ở đúng bên phải như màn rộng. */}
      {showPageButtons && (
        <div className="flex items-center gap-1 max-md:w-full max-md:justify-end">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Trang trước"
          >
            <ChevronLeft />
          </Button>

          {pageItems.map((item, index) =>
            item === PAGE_ELLIPSIS ? (
              // Dấu "…" không bấm được nên key theo vị trí là đủ (tối đa 2 cái).
              <span
                key={`gap-${index}`}
                aria-hidden
                className="px-1 text-sm text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === page ? 'default' : 'outline'}
                size="icon-sm"
                className="tabular-nums"
                aria-label={`Trang ${item}`}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            ),
          )}

          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            aria-label="Trang sau"
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  )
}
