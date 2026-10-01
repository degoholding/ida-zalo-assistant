import { useQueryClient } from '@tanstack/react-query'
import { RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useIsMobile } from '@/shared/hooks/use-mobile'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/shared/ui/table'
import { cn } from '@/shared/utils/cn'
import { columnColorStyle } from './column-color-palette'
import { ColumnDragOverlay } from './column-drag-overlay'
import { ColumnHeaderCell } from './column-header-cell'
import { ColumnVisibilityMenu } from './column-visibility-menu'
import { DataTableMobileCards } from './data-table-mobile-cards'
import { DataTablePagination } from './data-table-pagination'
import { FilterResetButton } from './filter-reset-button'
import { measureColumnContentWidth } from './measure-column-width'
import { columnLabel } from './required-header'
import type { DataTableColumn, DataTablePagination as PaginationConfig } from './types'
import { useColumnDrag } from './use-column-drag'
import { usePinnedOffsets } from './use-pinned-offsets'
import { useTableLayout } from './use-table-layout'

const DEFAULT_MIN_WIDTH = 64

/**
 * Lớp sơn đè lên `Table` mặc định của shadcn. Để ở đây (không sửa
 * `shared/ui/table.tsx`) vì đó là primitive dùng chung — sửa gốc là đổi luôn
 * mọi bảng khác.
 *
 * Mục tiêu: kẻ ô đầy đủ và MỌI dòng cùng một chiều cao. Chiều cao ô đặt cứng
 * (`h-*`) kèm `py-0` thay vì dùng padding dọc: nội dung mỗi cột một kiểu (chữ
 * thường, huy hiệu, ảnh đại diện) nên để padding tự tính thì dòng nào có huy
 * hiệu sẽ cao hơn hẳn dòng chỉ có chữ.
 */
/**
 * ⚠️ Viền của ô tiêu đề vẽ bằng `box-shadow` chứ KHÔNG dùng `border`.
 * Tailwind preflight đặt `border-collapse: collapse` cho mọi bảng; ở chế độ đó
 * viền thuộc về bảng chứ không thuộc ô, nên khi `<thead>` được `position:
 * sticky` thì trình duyệt bỏ luôn viền của nó — hàng tiêu đề trôi lơ lửng
 * không còn đường kẻ nào. `inset shadow` nằm ngoài cơ chế collapse nên vẫn hiện.
 */
const HEAD_CELL =
  'relative h-10 px-3 text-[13px] font-bold text-row-head-foreground bg-row-head shadow-[inset_-1px_0_0_0_var(--border),inset_0_-1px_0_0_var(--border)] last:shadow-[inset_0_-1px_0_0_var(--border)]'
/**
 * Ô THÂN BẢNG. Vạch dọc vẽ bằng `inset shadow`, KHÔNG dùng `border-r`.
 *
 * ⚠️ LỖI ĐÃ XẢY RA (27/08/2026, bảng màu Notebook). Trước đây ô thân dùng
 * `border-r` còn ô tiêu đề dùng `inset shadow` — hai cơ chế khác nhau vẽ CÙNG
 * một đường lưới, và bảng đang để `border-collapse: collapse`:
 *
 * - `border-r` khi collapse thì viền được CHIA ĐÔI qua ranh giới hai ô, tức vẽ
 *   ở khoảng `[mép − 0.5px, mép + 0.5px)`;
 * - `inset shadow` luôn vẽ HẲN BÊN TRONG ô, ở `[mép − 1px, mép)`.
 *
 * Lệch nửa pixel. Bộ màu DEGO có `--border` rất nhạt nên không ai thấy; bảng màu
 * Notebook đặt `--border` xám đậm thì lộ ngay — vạch dọc của tiêu đề và của thân
 * bảng so le nhau đúng chỗ chúng phải nối liền.
 *
 * Cột GHIM vốn đã vẽ bằng `inset shadow` (xem `PIN_*`) nên nó không dính lỗi này;
 * nay cả bảng dùng chung một cơ chế.
 */
const BODY_CELL =
  'min-h-9 px-3 py-1.5 align-middle text-[13.5px] text-foreground shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none'
/**
 * Vạch ngăn NHÓM cột (`dividerAfter`, bao-CR-519): cùng cơ chế `inset shadow` với vạch
 * thường, chỉ dày 2px và đậm màu hơn — đè lên shadow của `HEAD_CELL` / `BODY_CELL` nhờ
 * `tailwind-merge` (lớp sau thắng), ô tiêu đề giữ thêm vạch đáy.
 */
const DIVIDER_HEAD = 'shadow-[inset_-2px_0_0_0_var(--muted-foreground),inset_0_-1px_0_0_var(--border)]'
const DIVIDER_BODY = 'shadow-[inset_-2px_0_0_0_var(--muted-foreground)]'
/**
 * Thân bảng HÀNG CHẴN LẺ ĐẬM NHẠT XEN KẼ (Zebra striping đậm rõ màu):
 * Hàng lẻ (odd): nền thẻ `bg-card`
 * Hàng chẵn (even): `even:bg-row-stripe`
 * Hover: `hover:bg-row-hover` · Hàng đang chọn: `bg-row-selected`
 *
 * ⚠️ **KHÔNG dùng màu bảng màu Tailwind gốc ở đây** (`bg-slate-100`, `bg-sky-100`,
 * `bg-blue-100`…). Chúng KHÔNG đi theo bảng màu người dùng chọn, nên đổi giao diện
 * là một cái bảng có ba họ màu đánh nhau: hàng tiêu đề theo bảng màu, còn vằn hàng
 * và hover thì đứng yên màu xanh slate. Lỗi thật bắt được 27/08/2026 với bảng màu
 * Starry Night — tiêu đề kem, vằn hàng xanh, hover xanh lơ, ba màu chẳng liên quan
 * gì nhau. Năm token `--row-*` khai ở `index.css` và suy ra từ `--card`/`--primary`
 * cho bảng màu nhập ngoài.
 *
 * ⚠️ **NỀN HÀNG PHẢI ĐỤC, TUYỆT ĐỐI KHÔNG ALPHA.** Ô của cột GHIM lấy
 * `bg-inherit` từ hàng (xem `PIN_*` bên dưới), nên hàng trong suốt bao nhiêu thì
 * ô ghim trong suốt bấy nhiêu — và nội dung đang trôi ngang BÊN DƯỚI nó hiện
 * xuyên qua. Lỗi thật đã bắt được 24/08/2026: nền hover là `bg-sky-100/70` nên
 * cứ rê chuột vào một hàng của bảng đang cuộn ngang là chữ ở cột ghim chồng lên
 * chữ của cột đang trôi qua, đọc không ra chữ nào.
 *
 * Cùng một bài học đã ghi ở hàng TIÊU ĐỀ bên dưới (`bg-muted hover:bg-muted`)
 * mà lúc đó chưa soi lại thân bảng.
 *
 * ⚠️ NỀN TỐI cũng phải theo đúng luật đó. Chính chỗ này từng ghi "ngày bật chế
 * độ tối thì phải soi lại" — nay đã bật (CR-181), và `dark:even:bg-slate-800/60`
 * đúng là có alpha, nên đã bỏ `/60` thành nền đục hoàn toàn. Token `--row-*` khai
 * riêng giá trị cho `.dark`, nên ở đây không còn biến thể `dark:` nào nữa.
 */
const ROW_BG =
  'group odd:bg-card even:bg-row-stripe hover:bg-row-hover data-[state=selected]:bg-row-selected transition-colors'
/** Ô báo trạng thái (đang tải / lỗi / rỗng) trải hết bảng — không kẻ dọc, cao hơn. */
const SPAN_CELL = 'h-20 px-3 text-center'

/**
 * Vạch kẻ của Ô CỘT GHIM, viết sẵn thành hằng chứ không ghép chuỗi lúc chạy:
 * Tailwind quét MÃ NGUỒN để sinh class, tên class ghép động sẽ không có CSS nào
 * cả. Hậu tố `_HEAD` kèm vạch đáy của hàng tiêu đề, `_DROP` kèm bóng đổ báo có
 * nội dung đang trôi bên dưới.
 *
 * Bản `last:` của cột ghim phải là BẮT BUỘC với cột dính bên phải: nó luôn là ô
 * cuối hàng, mà `HEAD_CELL` có sẵn `last:shadow-…` (chỉ vạch đáy) — biến thể
 * `last:` có độ ưu tiên cao hơn class thường nên không ghi đè đúng biến thể đó
 * thì vạch trái bị nuốt mất. Đó chính là lỗi "ghim cột phải mà không có border".
 */
const PIN_LEFT = 'shadow-[inset_-1px_0_0_0_var(--border)]'
const PIN_LEFT_HEAD = 'shadow-[inset_-1px_0_0_0_var(--border),inset_0_-1px_0_0_var(--border)]'
const PIN_LEFT_DROP = 'shadow-[inset_-1px_0_0_0_var(--border),6px_0_8px_-6px_rgb(0_0_0/0.18)]'
const PIN_LEFT_HEAD_DROP =
  'shadow-[inset_-1px_0_0_0_var(--border),inset_0_-1px_0_0_var(--border),6px_0_8px_-6px_rgb(0_0_0/0.18)]'
const PIN_RIGHT = 'shadow-[inset_1px_0_0_0_var(--border)] last:shadow-[inset_1px_0_0_0_var(--border)]'
const PIN_RIGHT_HEAD =
  'shadow-[inset_1px_0_0_0_var(--border),inset_0_-1px_0_0_var(--border)] last:shadow-[inset_1px_0_0_0_var(--border),inset_0_-1px_0_0_var(--border)]'

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[] | undefined
  getRowId: (row: T) => string | number

  isLoading?: boolean
  isError?: boolean
  emptyMessage?: string
  errorMessage?: string

  onRowClick?: (row: T) => void
  /**
   * Bấm ĐÚP vào một hàng — cộng thêm, không đổi hành vi mặc định của
   * `onRowClick` (vẫn chạy trên MỌI cú bấm, kể cả cú đầu của một lượt bấm
   * đúp). Dùng cho màn cần tách "chọn" (bấm thường) khỏi "mở" (bấm đúp) kiểu
   * Google Drive — xem `folder-documents-table.tsx`, nơi dùng đầu tiên.
   */
  onRowDoubleClick?: (row: T, event: React.MouseEvent) => void
  /**
   * Class thêm cho MỘT HÀNG, tính theo dữ liệu của chính hàng đó.
   *
   * Dành cho bảng có hàng KHÔNG ĐỒNG HẠNG — hàng gom nhóm và hàng con của nó
   * (bảng Quỹ phép năm). Không có nó thì hai loại hàng chỉ khác nhau ở nội dung
   * một ô, và người đọc phải suy ra thứ bậc từ dấu thụt lề rộng 16px.
   *
   * ⚠️ Kẻ sọc chẵn/lẻ mặc định (`odd:bg-card even:bg-row-stripe`) ĐÈ ĐƯỢC từ
   * đây — `cn` gộp bằng `tailwind-merge` nên khai lại đúng cặp biến thể đó là
   * bản của hàng thắng. Bảng gom nhóm nên tắt sọc: sọc chạy theo thứ tự hàng
   * chứ không theo nhóm, nên nó cắt ngang đúng thứ bậc vừa dựng ra.
   */
  rowClassName?: (row: T) => string | undefined
  /**
   * Chạy khi con trỏ RÊ VÀO một dòng — dùng để NẠP TRƯỚC dữ liệu trang chi tiết.
   *
   * Vì sao cần: bấm một dòng rồi mới bắt đầu gọi API thì người dùng ngồi nhìn
   * khung trống. Đo trên bản chạy thật, mở một văn bản 100 trang mất **372ms**,
   * trong đó ~175ms chỉ là chờ mạng — mà quãng rê chuột tới lúc bấm thường đã
   * dài hơn thế. Nạp trước ở nhịp rê là lấp trọn quãng chờ đó mà không phải
   * đụng gì tới backend.
   *
   * Chỉ bắn MỘT LẦN cho mỗi dòng (`onMouseEnter`, không phải `onMouseMove`), và
   * bên nhận nên dùng `prefetchQuery` — nó tự bỏ qua nếu dữ liệu còn tươi, nên
   * rê qua rê lại không sinh thêm lượt gọi nào.
   */
  onRowHover?: (row: T) => void
  /**
   * Việc chạy khi bấm nút Tải lại. Bỏ trống thì bảng tự làm mới MỌI query đang
   * hoạt động của trang — đúng ý "xem số mới nhất" ở gần hết màn danh sách, nên
   * không bắt từng trang phải khai lại.
   */
  onRefresh?: () => void | Promise<unknown>
  /** Nội dung chèn bên TRÁI menu "Cột" (ô tìm kiếm, select, nút Bộ lọc…). */
  toolbar?: ReactNode
  /**
   * Class thêm cho DẢI thanh công cụ (khối bọc `toolbar` + nhóm nút bên phải).
   *
   * Có để trang ghim được dải này lên đầu khung cuộn (`sticky top-… bg-card`)
   * khi ở khổ điện thoại — lúc đó bảng biến thành danh sách thẻ dài và cả trang
   * cuộn, nên ô tìm kiếm sẽ trôi mất nếu không ghim. Trang phải tự khai vì mốc
   * `top` tùy thuộc thứ đang ghim phía trên nó ở CHÍNH trang đó.
   */
  toolbarClassName?: string
  /**
   * Class thêm cho NHÓM NÚT BÊN PHẢI của thanh công cụ (Xóa lọc · Tải lại · Cột).
   *
   * Nhóm này mặc định `ml-auto` — nó nuốt mọi chỗ trống của hàng để bám mép
   * phải. Đúng ở gần hết màn danh sách, nơi ô tìm kiếm `flex-1` đã ăn hết chỗ
   * trống nên `ml-auto` không còn gì để nuốt.
   *
   * Sai ở màn nào cho ô tìm chiếm TRỌN hàng đầu (`max-md:basis-full`): hàng nút
   * còn lại dư chỗ thật, và `ml-auto` xé nó thành hai mẩu cách nhau một hố —
   * ở màn Văn bản là **162px** giữa nút *Export* và nút *Tải lại*, đọc ra như
   * ba khối viền rời rạc chứ không ra một thanh công cụ (cùng lỗi duoc-CR-363
   * đã gọi tên ở thanh công cụ Dự án). Màn đó truyền `max-md:ml-0` để cả hàng
   * dồn về một cụm liền.
   */
  toolbarActionsClassName?: string
  /**
   * Việc chạy khi bấm **Xóa lọc**. Bỏ trống = nút tự xóa mọi param lọc trên URL
   * (đúng cho mọi màn danh sách, vì state bộ lọc nằm trên URL). Chỉ truyền vào
   * khi bảng giữ bộ lọc bằng state cục bộ — bảng con trong trang chi tiết.
   */
  onResetFilters?: () => void
  /**
   * Có bộ lọc nào đang bật không, quyết định nút **Xóa lọc** hiện hay ẩn. Bỏ
   * trống = tự suy từ query string. Đi kèm `onResetFilters`.
   */
  filtersActive?: boolean
  /**
   * Param trên URL của trang mà nút **Xóa lọc** phải GIỮ LẠI. Dùng cho trang đặt
   * tên param tab khác chữ `tab` (màn Sổ văn bản dùng `kind`, Quy tắc đánh số
   * dùng `direction`) — xem `FilterResetButtonProps.keepParams`.
   */
  keepFilterParams?: string[]
  /** Có thì bảng nhớ cột ẩn + độ rộng + thứ tự cột vào localStorage theo khóa này. */
  storageKey?: string
  /**
   * Báo ra khóa các cột ĐANG HIỆN, theo đúng thứ tự người dùng thấy, mỗi khi bố
   * cục cột đổi. Trang dùng nó để xuất Excel đúng bộ cột trên màn hình — không
   * có thì file xuất ra luôn là trọn bộ cột, lệch với thứ người dùng đang nhìn.
   */
  onVisibleColumnsChange?: (keys: string[]) => void
  pagination?: PaginationConfig
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  onSortChange?: (sortBy: string, sortDir: 'asc' | 'desc') => void
  /**
   * Bảng cao bằng khung chứa: thanh công cụ và phân trang đứng yên, chỉ phần
   * dòng dữ liệu cuộn. Cần cha là flex column có chiều cao xác định — dùng kèm
   * `<PageContainer fill>`.
   */
  fillHeight?: boolean
  /**
   * Nội dung MỘT THẺ ở chế độ màn hẹp (< 768px). Khai prop này là bật chế độ
   * đó: dưới ngưỡng mobile, bảng biến mất và danh sách vẽ thành thẻ xếp dọc.
   *
   * ⚠️ **Tự nguyện, không mặc định.** Màn nào chưa khai thì vẫn ra bảng cuộn
   * ngang như cũ — đổi hình dạng cho cả hệ bằng một prop mặc định là 40+ màn
   * đồng loạt đổi mà không ai xem lại từng cái. Dời dần từng màn.
   *
   * ⚠️ Thẻ KHÔNG đọc `columns`: cột khai bề rộng, thứ tự, ghim — toàn thứ chỉ
   * có nghĩa trong lưới. Ở thẻ, người dựng tự chọn bày trường nào và bày theo
   * thứ bậc nào; suy máy móc từ danh sách cột chỉ ra một cái bảng dựng đứng.
   * Cũng vì thế menu «Cột» tự ẩn ở chế độ này — không còn cột nào để ẩn/hiện.
   */
  mobileCard?: (row: T) => ReactNode
}

/**
 * Bảng danh sách dùng chung cho mọi màn: ẩn/hiện cột, kéo giãn cột, kéo thả
 * đổi thứ tự cột, phân trang.
 *
 * Chỉ lo phần TRÌNH BÀY. Việc gọi API, lọc và giữ state trang vẫn nằm ở trang
 * gọi nó — nhờ vậy bảng dùng được cả với danh sách phân trang phía server
 * (nhân sự, công ty) lẫn danh sách nạp một lần (nhân sự thuộc phòng ban).
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  isLoading,
  isError,
  emptyMessage = 'Không có dữ liệu.',
  errorMessage = 'Không tải được danh sách. Kiểm tra kết nối hoặc quyền truy cập.',
  onRowClick,
  onRowDoubleClick,
  rowClassName,
  onRowHover,
  onRefresh,
  toolbar,
  toolbarClassName,
  toolbarActionsClassName,
  onResetFilters,
  filtersActive,
  keepFilterParams,
  storageKey,
  onVisibleColumnsChange,
  pagination,
  sortBy,
  sortDir,
  onSortChange,
  fillHeight = false,
  mobileCard,
}: DataTableProps<T>) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  //  Chỉ đúng khi màn khai `mobileCard`; không khai thì hook vẫn chạy nhưng
  //  không ai đọc kết quả — rẻ hơn nhiều so với gọi hook có điều kiện (cấm).
  const asCards = useIsMobile() && !!mobileCard

  /**
   * Tải lại dữ liệu. Cờ `refreshing` do CHÍNH nút giữ (không dùng `isFetching`
   * của trang): vòng xoay phải chạy đủ trọn một nhịp bấm kể cả khi dữ liệu về
   * gần như tức thì, nếu không thì bấm xong chẳng thấy gì phản hồi.
   */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await (onRefresh ? onRefresh() : queryClient.invalidateQueries({ type: 'active' }))
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, queryClient])
  const {
    layout,
    orderedColumns,
    visibleColumns,
    toggleColumn,
    setColumnWidth,
    setColumnWidths,
    setColumnColor,
    moveColumn,
    togglePin,
    resetLayout,
  } = useTableLayout(columns, storageKey)

  //  Màu hiệu lực = màu người dùng tự chọn, không có thì màu khai SẴN (`defaultColor`) —
  //  cùng luật `LinesTable`; dùng chung cho menu «Cột», tiêu đề và thân bảng.
  const columnColors = useMemo(() => {
    const merged: Record<string, string> = {}
    for (const column of columns) {
      if (column.defaultColor) merged[column.key] = column.defaultColor
    }
    return { ...merged, ...layout.columnColors }
  }, [columns, layout.columnColors])

  const { drag, startDrag } = useColumnDrag(moveColumn)
  const tableRef = useRef<HTMLTableElement>(null)

  const columnCount = visibleColumns.length
  const widthOf = (column: DataTableColumn<T>) => layout.columnWidths[column.key] ?? column.width

  /**
   * SÀN bề rộng của cả bảng = tổng bề rộng các cột đang hiện.
   *
   * ⚠️ Đây là `min-width`, KHÔNG phải `width` — bảng vẫn `w-full` nên khung rộng
   * hơn thì nó giãn ra như cũ và cột không khai bề rộng vẫn nuốt trọn phần dư.
   * Sàn chỉ có tác dụng khi khung HẸP hơn tổng bề rộng cột: thiếu nó thì
   * `table-fixed` co mọi cột lại theo tỷ lệ, cột khai `wrap` (Lý do, Ghi chú…)
   * bị bóp còn vài chục pixel và chữ trong đó rớt xuống ba mươi dòng — một hàng
   * cao 600px (lỗi thấy được 04/09/2026 ở màn Đơn nghỉ phép, khung 940px). Có
   * sàn thì phần dôi ra thành thanh cuộn ngang của chính bảng.
   *
   * ⚠️ Phải TỰ CỘNG chứ không dùng được `min-w-max` của Tailwind: bảng
   * `table-fixed` chỉ tính `max-content` từ những cột CÓ khai bề rộng, nên cột
   * để trống (`width` undefined) tụt về 0 và biến mất. Ở đây cột đó lấy sàn
   * `minWidth` của chính nó.
   */
  const minTableWidth = visibleColumns.reduce(
    (sum, column) => sum + (widthOf(column) ?? column.minWidth ?? DEFAULT_MIN_WIDTH),
    0,
  )

  /**
   * Báo bộ cột đang hiện ra ngoài. Gộp thành chuỗi rồi mới so ở mảng phụ thuộc:
   * `visibleColumns` là mảng dựng lại sau mỗi lần render nên so theo tham chiếu
   * sẽ bắn liên tục, kéo theo vòng render vô tận ở trang cha.
   */
  const visibleColumnKeys = visibleColumns.map((column) => column.key).join(',')
  useEffect(() => {
    onVisibleColumnsChange?.(visibleColumnKeys ? visibleColumnKeys.split(',') : [])
  }, [visibleColumnKeys, onVisibleColumnsChange])

  /**
   * Cột ghim theo đúng thứ tự đang hiện (chúng luôn đứng đầu — xem
   * `useTableLayout`). Mốc `left` do `usePinnedOffsets` ĐO TỪ DOM.
   */
  const pinnedKeys = useMemo(() => {
    const keys: string[] = []
    for (const column of visibleColumns) {
      if (!layout.pinnedColumns.includes(column.key)) break
      keys.push(column.key)
    }
    return keys
  }, [visibleColumns, layout.pinnedColumns])

  const pinnedRightKeys = useMemo(
    () => visibleColumns.filter((column) => column.stickyRight).map((column) => column.key),
    [visibleColumns],
  )

  const { headerRowRef, pinnedOffsets, pinnedRightOffsets, scrolledX } = usePinnedOffsets(
    pinnedKeys,
    pinnedRightKeys,
  )
  const lastPinnedKey = pinnedKeys.at(-1)
  const beforePinnedRightKey = useMemo(() => {
    const firstRightIndex = visibleColumns.findIndex((column) => column.stickyRight)
    return firstRightIndex > 0 ? visibleColumns[firstRightIndex - 1]?.key : undefined
  }, [visibleColumns])

  /**
   * Co MỌI cột đang hiện cho vừa nội dung — như nháy đúp vào từng vạch kéo giãn
   * nhưng làm một lượt. Đo trên DOM thật nên số thứ tự cột lấy theo hàng đang
   * hiện (khác thứ tự khai báo khi có cột ẩn / cột ghim).
   *
   * Ghi cả bảng bằng MỘT lần lưu: gọi `setColumnWidth` từng cột thì mỗi lần lại
   * lưu đè lên `layout` cũ đọc được lúc dựng hàm, chỉ cột cuối sống sót.
   */
  const autoFitAll = useCallback(() => {
    const table = tableRef.current
    if (!table) return

    const widths: Record<string, number> = {}
    visibleColumns.forEach((column, index) => {
      widths[column.key] = measureColumnContentWidth(table, index, {
        min: column.minWidth ?? DEFAULT_MIN_WIDTH,
      })
    })
    setColumnWidths(widths)
  }, [visibleColumns, setColumnWidths])

  /**
   * Class của ô thuộc cột ghim. Nền `bg-inherit` để ăn theo nền của HÀNG (hàng
   * phải có nền ĐỤC — xem `ROW_BG`), nếu để trong suốt thì phần bảng cuộn qua
   * bên dưới sẽ lộ xuyên qua cột đang dính.
   *
   * `head` = ô này nằm ở hàng tiêu đề, phải kẻ thêm VẠCH ĐÁY: chuỗi shadow ở
   * đây ghi đè shadow của `HEAD_CELL` (tailwind-merge, cùng nhóm `shadow`, cái
   * sau thắng) nên không tự vẽ lại thì hàng tiêu đề thủng một đoạn ngay dưới
   * cột ghim.
   */
  const pinClass = (key: string, head = false) => {
    if (pinnedKeys.includes(key)) {
      const hasShadow = key === lastPinnedKey && scrolledX
      return cn(
        // MỌI ô ghim đều tắt `border-r` và tự vẽ vạch bằng `inset shadow`: ô dính
        // nằm đè lên ô kế bên, để cả hai cùng có đường kẻ thì thành vạch đôi.
        'sticky z-20 border-r-0 bg-inherit',
        // Vạch luôn MẢNH 1px như mọi cột khác — vạch dày ở cột ghim cuối trông
        // như bị kẻ viền chồng lên nhau. Ranh giới phần đứng yên / phần đang trôi
        // báo bằng bóng đổ, và chỉ khi bảng đã cuộn ngang.
        hasShadow
          ? head
            ? PIN_LEFT_HEAD_DROP
            : PIN_LEFT_DROP
          : head
            ? PIN_LEFT_HEAD
            : PIN_LEFT,
      )
    }

    if (pinnedRightKeys.includes(key)) {
      //  ⚠️ KHÔNG dùng `border-l`: preflight đặt `border-collapse: collapse`, ở
      //  chế độ đó viền thuộc về bảng chứ không thuộc ô, nên ô `position: sticky`
      //  bị bỏ mất viền — cột ghim phải trôi lơ lửng không một nét kẻ nào (đúng
      //  lỗi phải vá ở đây). Vạch vẽ bằng `inset shadow` như hàng tiêu đề dính.
      //
      //  Vạch của cột KẾ BÊN đã được tắt (`beforePinnedRightKey`) nên không có
      //  chuyện hai nét 1px nằm sát nhau.
      return cn('sticky z-20 border-r-0 border-l-0 bg-inherit', head ? PIN_RIGHT_HEAD : PIN_RIGHT)
    }

    return undefined
  }

  /** `left` của ô dính; `undefined` nếu cột không ghim (hoặc chưa đo xong). */
  const pinOffset = (key: string) => pinnedOffsets[key]
  /** `right` của ô thao tác cố định bên phải. */
  const pinRightOffset = (key: string) => pinnedRightOffsets[key]

  return (
    <div className={cn('flex flex-col', fillHeight && 'min-h-0 flex-1')}>
      {(toolbar || (!asCards && columns.some((c) => c.hideable !== false))) && (
        <div
          className={cn('mb-4 flex shrink-0 flex-wrap items-center gap-3', toolbarClassName)}
        >
          {toolbar}
          <div className={cn('ml-auto flex items-center gap-2', toolbarActionsClassName)}>
            {/*  Nút "Xóa lọc" do BẢNG vẽ, không bắt từng màn tự nhớ: quên một
                 màn là màn đó lọc xong không có đường lùi. Đứng sát mép phải
                 ngay trước nút Tải lại, và tự ẩn khi chưa lọc gì. */}
            {toolbar && (
              <FilterResetButton
                active={filtersActive}
                keepParams={keepFilterParams}
                onReset={onResetFilters}
              />
            )}

            <Button
              variant="outline"
              size="icon"
              title="Tải lại dữ liệu"
              aria-label="Tải lại dữ liệu"
              disabled={refreshing}
              onClick={handleRefresh}
            >
              <RotateCw className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>

            {/*  Chế độ thẻ không có cột nào để ẩn/hiện, ghim hay đổi thứ tự —
                 để menu lại là mời người dùng bấm vào một bảng điều khiển
                 không điều khiển thứ gì đang nhìn thấy. */}
            {!asCards && (
              <ColumnVisibilityMenu
                // Menu liệt kê theo thứ tự đang xem, không theo thứ tự khai báo —
                // kéo cột xong mà menu vẫn xếp kiểu cũ thì rất khó dò.
                columns={orderedColumns}
                hiddenColumns={layout.hiddenColumns}
                pinnedColumns={layout.pinnedColumns}
                columnColors={columnColors}
                onToggle={toggleColumn}
                onTogglePin={togglePin}
                onAutoFitAll={autoFitAll}
                onColorChange={setColumnColor}
                onMove={moveColumn}
                onReset={resetLayout}
              />
            )}
          </div>
        </div>
      )}

      {asCards && mobileCard && (
        <DataTableMobileCards
          rows={rows}
          getRowId={getRowId}
          renderCard={mobileCard}
          isLoading={isLoading}
          isError={isError}
          emptyMessage={emptyMessage}
          errorMessage={errorMessage}
          onRowClick={onRowClick}
          fillHeight={fillHeight}
        />
      )}

      {/*
        Khung viền bao cả bảng; `overflow-hidden` để 4 góc bo không bị ô đè lên.

        `isolate` (isolation: isolate) TẠO NGỮ CẢNH XẾP LỚP riêng: mọi `z-index`
        của hàng tiêu đề dính và cột ghim bên trong chỉ so với nhau, không thể
        trồi lên trên thanh tiêu đề của trang (z-10) khi cuộn.

        ⚠️ Chế độ thẻ GỠ HẲN bảng khỏi cây, không phải giấu bằng `hidden`: bảng
        tự đo cột từ DOM (`usePinnedOffsets`, `measureColumnContentWidth`) mà mọi
        kích thước đọc trong cây `display:none` đều là 0 — mốc `left` của cột
        ghim sẽ bị ghi đè bằng số rác ngay trong lúc không ai nhìn thấy.
      */}
      {!asCards && (
      <div
        className={cn(
          'isolate overflow-hidden rounded-lg border',
          fillHeight && 'flex min-h-0 flex-1 flex-col',
        )}
      >
        {/*
          `table-fixed`: độ rộng cột do khai báo/kéo giãn quyết định, không bị nội
          dung dài trong một ô kéo cả cột phình ra. Không có nó thì kéo giãn xong
          trình duyệt lại tự tính lại và cột nhảy về chỗ cũ.

          `minWidth` là SÀN co lại của bảng — xem `minTableWidth` ở trên.
        */}
        <Table
          ref={tableRef}
          className="table-fixed"
          style={{ minWidth: minTableWidth }}
          //  `scrollbar-slim` (khai ở `index.css`): thanh cuộn phải LUÔN HIỆN.
          //  Bảng danh sách cũng rộng hơn khung ở khổ tablet, và thanh cuộn kiểu
          //  chồng của macOS tự mờ đi — trên máy có chuột thì không còn đường nào
          //  cuộn ngang, mấy cột bên phải thành không với tới được. Cùng lý do đã
          //  ghi ở `lines-table`.
          containerClassName={cn('scrollbar-slim', fillHeight && 'min-h-0 flex-1 overflow-auto')}
        >
          {/*
            Nền hàng tiêu đề phải ĐỤC (`bg-row-head`, không phải `/60`): vừa để
            dòng trôi qua bên dưới không lộ ra khi tiêu đề dính đỉnh, vừa để ô
            của cột ghim `bg-inherit` che được phần bảng cuộn ngang phía sau.
          */}
          {/*
            `[&_tr]:border-b-0` GỠ vạch đáy mà `TableHeader` của shadcn tự đặt
            lên hàng tiêu đề. Không thừa: ô tiêu đề đã tự vẽ vạch đáy bằng
            `inset shadow` (xem `HEAD_CELL`), giữ cả hai là hai đường 1px nằm sát
            nhau — hàng tiêu đề trông dày gấp đôi mọi đường kẻ khác trong bảng.
            Bỏ cái `border` chứ không bỏ cái `shadow`, vì `border-collapse` làm
            border của hàng tiêu đề dính đỉnh biến mất khi cuộn.
          */}
          <TableHeader
            className={cn('bg-row-head [&_tr]:border-b-0', fillHeight && 'sticky top-0 z-30')}
          >
            {/*
              `hover:bg-row-head` KHÔNG thừa: `TableRow` của shadcn mặc định có
              `hover:bg-muted/50` — nền CÓ ALPHA. Rê chuột lên hàng tiêu đề đang
              dính đỉnh là nó trong suốt một nửa, các dòng trôi bên dưới hiện
              xuyên qua (và ô cột ghim `bg-inherit` cũng lộ theo). Ghi đè bằng
              đúng màu đục để hover không đổi gì cả.
            */}
            <TableRow ref={headerRowRef} className="bg-row-head hover:bg-row-head">
              {visibleColumns.map((column) => (
                <ColumnHeaderCell
                  key={column.key}
                  column={column}
                  width={widthOf(column)}
                  className={cn(
                    HEAD_CELL,
                    column.dividerAfter && DIVIDER_HEAD,
                    alignClass(column.align),
                    pinClass(column.key, true),
                  )}
                  colorStyle={columnColorStyle(columnColors[column.key], 'head')}
                  pinnedOffset={pinOffset(column.key)}
                  pinnedRightOffset={pinRightOffset(column.key)}
                  suppressRightDivider={column.key === beforePinnedRightKey}
                  minWidth={column.minWidth ?? DEFAULT_MIN_WIDTH}
                  draggable={!column.stickyRight}
                  dragging={drag?.fromKey === column.key}
                  sortDir={sortBy === column.key ? sortDir : null}
                  onSort={
                    onSortChange
                      ? () => {
                          //  Ba nhịp: tăng → giảm → THÔI SẮP XẾP. Bản cũ chỉ đảo
                          //  qua lại tăng/giảm nên bấm nhầm một phát là kẹt luôn,
                          //  muốn về thứ tự gốc chỉ còn cách tải lại trang hoặc
                          //  tự xóa tham số trên thanh địa chỉ.
                          //
                          //  Nhịp thứ ba trả về khóa cột RỖNG — mọi màn đều bọc
                          //  `if (sortBy)` trước khi gắn `sort_by` vào tham số,
                          //  nên rỗng nghĩa là không gửi gì và backend xếp theo
                          //  mặc định của nó.
                          //  Cột khai `sortDescFirst` (cột thời gian) đảo chu
                          //  kỳ: giảm → tăng → thôi — bấm vào "Ngày cập nhật"
                          //  là muốn thấy bản ghi mới nhất ngay nhịp đầu.
                          const firstDir = column.sortDescFirst ? 'desc' : 'asc'
                          const secondDir = column.sortDescFirst ? 'asc' : 'desc'
                          if (sortBy !== column.key) return onSortChange(column.key, firstDir)
                          if (sortDir === firstDir) return onSortChange(column.key, secondDir)
                          onSortChange('', 'asc')
                        }
                      : undefined
                  }
                  onResize={(next) => setColumnWidth(column.key, next)}
                  onDragStart={(event) => startDrag(event, column.key, columnLabel(column.header))}
                />
              ))}
            </TableRow>
          </TableHeader>

          {/*
            `TableBody` của shadcn bỏ `border-b` ở dòng cuối — hợp lý khi bảng
            kết thúc sát viền khung (hai đường sẽ chồng nhau). Nhưng ở chế độ
            fit chiều cao còn khoảng trống bên dưới, thiếu vạch đó là bảng hở đáy.
          */}
          <TableBody className={cn(fillHeight && '[&_tr:last-child]:border-b')}>
            {isLoading &&
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  <TableCell colSpan={columnCount} className={BODY_CELL}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!isLoading && isError && (
              <TableRow>
                <TableCell colSpan={columnCount} className={cn(SPAN_CELL, 'text-destructive')}>
                  {errorMessage}
                </TableCell>
              </TableRow>
            )}

            {!isLoading && !isError && rows?.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount} className={cn(SPAN_CELL, 'text-muted-foreground')}>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}

            {!isLoading &&
              !isError &&
              rows?.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  className={cn(ROW_BG, onRowClick && 'cursor-pointer', rowClassName?.(row))}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onDoubleClick={onRowDoubleClick ? (event) => onRowDoubleClick(row, event) : undefined}
                  onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                >
                  {visibleColumns.map((column) => {
                    let content = column.cell(row)
                    if (typeof content === 'string' && (content === '—' || content === '-')) {
                      content = ''
                    }
                    return (
                      <TableCell
                        key={column.key}
                        style={{
                          width: widthOf(column),
                          left: pinOffset(column.key),
                          right: pinRightOffset(column.key),
                          borderRightWidth: column.key === beforePinnedRightKey ? 0 : undefined,
                          // Màu cột đặt SAU nền của hàng: ô đã tô màu giữ nguyên
                          // màu đó kể cả khi rê chuột, đúng ý "đánh dấu cột".
                          ...columnColorStyle(columnColors[column.key], 'cell'),
                        }}
                        className={cn(
                          BODY_CELL,
                          column.dividerAfter && DIVIDER_BODY,
                          alignClass(column.align),
                          pinClass(column.key),
                          // Cột đang bay theo con trỏ thì bản gốc mờ đi —
                          // xem ghi chú ở `column-header-cell.tsx`.
                          drag?.fromKey === column.key && 'opacity-40',
                        )}
                      >
                        {/*
                          Bọc `truncate` giống ô tiêu đề: kéo cột hẹp lại thì chữ
                          cắt bằng dấu "…" thay vì bị xén cụt giữa chừng. Đặt trên
                          bọc chứ không trên `<td>` vì `text-overflow` chỉ ăn ở
                          khối chứa trực tiếp dòng chữ.
                        */}
                        <div
                          className={cn(
                            column.wrap ? 'leading-snug break-words whitespace-normal' : 'truncate',
                          )}
                          title={typeof content === 'string' ? content : undefined}
                        >
                          {content}
                        </div>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      )}

      {pagination && <DataTablePagination {...pagination} />}

      {/* Lớp phủ lúc kéo cột (bóng cột bám con trỏ + cột đích sáng lên + vạch thả
          suốt chiều cao bảng) — tự vẽ nên bám sát từng khung hình, khác ảnh kéo
          mờ và trễ nhịp của HTML5 drag-and-drop. */}
      {drag && <ColumnDragOverlay drag={drag} />}
    </div>
  )
}

function alignClass(align: DataTableColumn<unknown>['align']) {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return undefined
}
