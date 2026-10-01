import { Columns3, MoveHorizontal } from 'lucide-react'
import { useCallback, useMemo, useRef, type ReactNode } from 'react'

import { useHorizontalOverflow } from '@/shared/hooks/use-horizontal-overflow'
import { Button } from '@/shared/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { cn } from '@/shared/utils/cn'
import { columnColorStyle } from './column-color-palette'
import { ColumnDragOverlay } from './column-drag-overlay'
import { ColumnHeaderCell } from './column-header-cell'
import { ColumnVisibilityMenu } from './column-visibility-menu'
import { LINE_COLUMN_MIN_WIDTH, lineColumnMinWidth, lineColumnWidth } from './line-column-width'
import { measureColumnContentWidth } from './measure-column-width'
import { columnLabel } from './required-header'
import type { DataTableColumn, LinesTableColumn } from './types'
import { useColumnDrag } from './use-column-drag'
import { usePinnedOffsets } from './use-pinned-offsets'
import { useTableLayout } from './use-table-layout'

/**
 * ⚠️ Viền ô tiêu đề vẽ bằng `box-shadow`, KHÔNG dùng `border` — giống `DataTable`.
 * Tailwind preflight đặt `border-collapse: collapse`, ở chế độ đó viền thuộc về
 * bảng chứ không thuộc ô, nên `<thead>` dính đỉnh là mất sạch đường kẻ.
 */
const HEAD_CELL =
  'relative h-10 px-2.5 text-[13px] font-bold text-row-head-foreground bg-row-head shadow-[inset_-1px_0_0_0_var(--border),inset_0_-1px_0_0_var(--border)] last:shadow-[inset_0_-1px_0_0_var(--border)]'
/**
 * Vạch dọc vẽ bằng `inset shadow` cho khớp hàng tiêu đề — xem chú thích dài ở
 * `BODY_CELL` trong `data-table.tsx` về lỗi lệch nửa pixel do trộn `border-r`
 * (bị chia đôi khi `border-collapse: collapse`) với `inset shadow`.
 */
const BODY_CELL =
  'px-2.5 py-1.5 align-middle text-[13.5px] text-foreground shadow-[inset_-1px_0_0_0_var(--border)] last:shadow-none'
/**
 * Nền hàng xen kẽ sọc đậm/nhạt rõ nét (zebra: odd `bg-card`, even `bg-row-stripe`).
 * Ô của cột ghim lấy `bg-inherit` từ hàng nên tự động thừa hưởng màu sọc tương ứng.
 *
 * ⚠️ Và **chính vì `bg-inherit` mà nền hàng không được có ALPHA**: hàng trong
 * suốt bao nhiêu thì ô cột ghim trong suốt bấy nhiêu, để lộ nội dung đang trôi
 * ngang bên dưới. Lỗi thật 24/08/2026 — nền hover cũ là `bg-sky-100/70` nên rê
 * chuột vào một hàng của bảng đang cuộn ngang là hai dòng chữ chồng lên nhau.
 * Giữ hệt luật của `data-table.tsx`, hai bảng này phải nói cùng một câu.
 */
const ROW_BG =
  'group odd:bg-card even:bg-row-stripe hover:bg-row-hover data-[state=selected]:bg-row-selected transition-colors'

export interface LinesTableProps<T> {
  columns: LinesTableColumn[]
  rows: T[]
  /** Khóa nhớ bố cục cột trong localStorage (`erp.table.<key>`). */
  storageKey: string
  /** Khóa React của hàng — dòng chưa lưu chưa có id nên cần cả chỉ số. */
  rowKey: (row: T, index: number) => string | number
  /** Vẽ nội dung một ô. `key` là khóa cột, `index` là vị trí dòng trong mảng. */
  renderCell: (columnKey: string, row: T, index: number) => ReactNode
  /** Tiêu đề bên trái thanh công cụ. */
  title: ReactNode
  /** Nút riêng của từng bảng (Thêm dòng, Thêm nhiều…), đặt cạnh tiêu đề. */
  actions?: ReactNode
  emptyMessage: ReactNode
  /**
   * Lần đầu mở bảng thì ẩn sẵn nhóm cột phụ (`compactHidden`). Dành cho bảng
   * quá nhiều cột — mở ra là một rừng chữ, người dùng bấm "Bảng đầy đủ" khi cần.
   * Chỉ là MẶC ĐỊNH: bố cục người dùng đã chỉnh vẫn được nhớ như thường.
   */
  defaultCompact?: boolean
  rowClassName?: (row: T, index: number) => string | undefined
  cellClassName?: (columnKey: string, row: T, index: number) => string | undefined
}

/**
 * Bảng DÒNG CHỨNG TỪ dùng chung: ẩn/hiện cột, ghim cột, kéo thả đổi thứ tự, kéo
 * giãn, tô màu cột, nhớ vào localStorage — đúng bộ đồ nghề của `DataTable` nhưng
 * cho bảng SỬA ĐƯỢC (ô chứa input/select, nội dung vẽ theo chỉ số dòng).
 *
 * Thêm nút "Bảng rút gọn / Bảng đầy đủ": bung ra là hiện hết nhóm cột phụ
 * (`compactHidden`), thu lại thì chỉ còn các cột xương sống.
 *
 * ⚠️ KHÔNG đặt bề rộng cứng cho `<table>`. `table-fixed` + `w-full` cho bề rộng
 * bằng max(khung chứa, tổng bề rộng cột): ẩn bớt cột thì bảng vẫn phủ kín khung,
 * mở nhiều cột thì tự cuộn ngang. Đặt `width: tổng cột` là ẩn cột xong bảng co
 * lại, chừa một khoảng trắng bên phải trong khung viền.
 */
export function LinesTable<T>({
  columns,
  rows,
  storageKey,
  rowKey,
  renderCell,
  title,
  actions,
  emptyMessage,
  defaultCompact,
  rowClassName,
  cellClassName,
}: LinesTableProps<T>) {
  /**
   * `useTableLayout` nhận cột của bảng danh sách; bảng dòng không khai `cell` nên
   * bù vào một hàm rỗng. Nội dung ô do `renderCell` vẽ.
   *
   * Bề rộng được CHUẨN HÓA ngay tại đây (`line-column-width.ts`) để phần còn lại
   * của bảng chỉ còn đọc `column.width` / `column.minWidth` — sàn của cột chọn
   * ngày vì thế áp cho cả ô tiêu đề, ô dữ liệu lẫn tay kéo giãn, không sót chỗ nào.
   */
  const layoutColumns = useMemo<DataTableColumn<T>[]>(
    () =>
      columns.map((column) => ({
        ...column,
        cell: () => null,
        defaultHidden: defaultCompact && column.compactHidden,
        width: lineColumnWidth(column),
        minWidth: lineColumnMinWidth(column),
      })),
    [columns, defaultCompact],
  )

  const {
    layout,
    orderedColumns,
    visibleColumns,
    toggleColumn,
    setHiddenColumns,
    setColumnWidth,
    setColumnWidths,
    setColumnColor,
    moveColumn,
    togglePin,
    resetLayout,
  } = useTableLayout(layoutColumns, storageKey)

  //  Màu hiệu lực của từng cột = màu người dùng tự chọn, không có thì màu khai SẴN
  //  (`defaultColor`). Tính một lần rồi dùng cho cả menu «Cột», tiêu đề lẫn thân bảng,
  //  để ô màu trong menu nói đúng màu đang thấy trên bảng.
  const columnColors = useMemo(() => {
    const merged: Record<string, string> = {}
    for (const column of columns) {
      if (column.defaultColor) merged[column.key] = column.defaultColor
    }
    return { ...merged, ...layout.columnColors }
  }, [columns, layout.columnColors])

  const { drag, startDrag } = useColumnDrag(moveColumn)
  const tableRef = useRef<HTMLTableElement>(null)

  //  Khung cuộn ngang của bảng — dùng để vẽ dải mờ báo "còn cột bên kia".
  //  Xem `useHorizontalOverflow`.
  const scrollRef = useRef<HTMLDivElement>(null)
  const overflow = useHorizontalOverflow(scrollRef)

  /** Cột ghim theo đúng thứ tự đang hiện — chúng luôn là dải đầu bảng. */
  const pinnedKeys = useMemo(() => {
    const keys: string[] = []
    for (const column of visibleColumns) {
      if (!layout.pinnedColumns.includes(column.key)) break
      keys.push(column.key)
    }
    return keys
  }, [visibleColumns, layout.pinnedColumns])

  const { headerRowRef, pinnedOffsets, scrolledX } = usePinnedOffsets(pinnedKeys)
  const lastPinnedKey = pinnedKeys.at(-1)

  const compactKeys = useMemo(
    () => columns.filter((column) => column.compactHidden).map((column) => column.key),
    [columns],
  )
  const isCompact =
    compactKeys.length > 0 && compactKeys.every((key) => layout.hiddenColumns.includes(key))

  function toggleCompactMode() {
    if (isCompact) {
      setHiddenColumns((prev) => prev.filter((key) => !compactKeys.includes(key)))
    } else {
      setHiddenColumns((prev) => Array.from(new Set([...prev, ...compactKeys])))
    }
  }

  const autoFitAll = useCallback(() => {
    const table = tableRef.current
    if (!table) return

    const widths: Record<string, number> = {}
    visibleColumns.forEach((column, index) => {
      widths[column.key] = measureColumnContentWidth(table, index, {
        min: column.minWidth ?? LINE_COLUMN_MIN_WIDTH,
      })
    })
    setColumnWidths(widths)
  }, [visibleColumns, setColumnWidths])

  const widthOf = (column: DataTableColumn<T>) =>
    lineColumnWidth(column, layout.columnWidths[column.key])

  /**
   * Ô thuộc cột ghim: nền `bg-inherit` ăn theo hàng, tự vẽ vạch bằng `inset
   * shadow` (ô dính nằm đè lên ô kế bên, để cả hai cùng `border-r` là vạch đôi).
   */
  const pinClass = (key: string) =>
    pinnedKeys.includes(key) &&
    cn(
      'sticky z-20 border-r-0 bg-inherit',
      'shadow-[inset_-1px_0_0_0_var(--border)]',
      key === lastPinnedKey &&
        scrolledX &&
        'shadow-[inset_-1px_0_0_0_var(--border),6px_0_8px_-6px_rgb(0_0_0/0.18)]',
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {actions}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleCompactMode}
            disabled={compactKeys.length === 0}
            title="Chuyển chế độ xem rút gọn / đầy đủ"
          >
            <Columns3 />
            {isCompact ? 'Bảng đầy đủ' : 'Bảng rút gọn'}
          </Button>

          {/*
            Cùng một thao tác với mục "Vừa nội dung tất cả cột" trong menu "Cột",
            nhưng bày thẳng ra ngoài. Đây là đường thoát cho MỌI cột bị cắt chữ mà
            sàn khai sẵn không với tới (ô số tiền dài, tên NCC, ghi chú…): sàn chỉ
            biết trước loại ô, còn nội dung thật thì chỉ đo tại chỗ mới ra.
          */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={autoFitAll}
            title="Giãn từng cột vừa đúng nội dung đang hiện"
          >
            <MoveHorizontal />
            Vừa nội dung
          </Button>

          <ColumnVisibilityMenu
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
        </div>
      </div>

      {/*
        `isolate` tạo ngữ cảnh xếp lớp riêng: `z-index` của cột ghim chỉ so với
        nhau, không trồi lên trên thanh tiêu đề của trang khi cuộn.
      */}
      {/*
        `relative` để treo hai dải mờ ở mép; chúng nằm NGOÀI khung cuộn nên
        đứng yên khi vuốt, thay vì trôi theo nội dung.
      */}
      <div className="relative isolate overflow-hidden rounded-lg border">
        {/*
          ⚠️ **Dải mờ mép bảng — đây là thứ DUY NHẤT nói rằng còn cột bên kia.**

          Bảng dòng rộng 1350–3600px trong khung vài trăm pixel, mà thanh cuộn
          ngang thì iOS/macOS mặc định ẩn tới khi có thao tác. Không có dải này
          thì bảng chỉ hiện chữ cụt giữa chừng ở mép phải — người dùng đọc ra là
          "chữ bị lỗi", không phải "vuốt sang đi" (khách báo 14/09/2026 ở bảng
          dòng phiếu yêu cầu mua hàng).

          `pointer-events-none` là bắt buộc: dải nằm ĐÈ lên mép bảng, không có
          nó thì nó nuốt cú chạm vào ô dưới cùng bên phải — ô đó lại thường là ô
          nhập. `z-30` để nổi trên cột ghim (`z-20`), nếu không cột ghim trái
          che mất dải trái.
        */}
        {overflow.left && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-30 w-6 bg-gradient-to-r from-background to-transparent"
          />
        )}
        {overflow.right && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-30 w-6 bg-gradient-to-l from-background to-transparent"
          />
        )}

        {/*  `scrollbar-slim` (khai ở `index.css`): thanh cuộn ngang phải LUÔN
             HIỆN. Thanh cuộn kiểu chồng của macOS/iOS tự mờ đi, nên trên máy
             có chuột thì không còn đường nào cuộn ngang — mấy chục cột bên phải
             thành KHÔNG VỚI TỚI ĐƯỢC, chứ không phải chỉ khó thấy. Dải mờ ở mép
             nói "còn nữa", thanh cuộn này mới là chỗ để kéo. */}
        <Table
          ref={tableRef}
          containerRef={scrollRef}
          containerClassName="scrollbar-slim"
          className="table-fixed"
        >
          <TableHeader className="bg-row-head">
            {/*
              `hover:bg-row-head` không thừa: `TableRow` mặc định có `hover:bg-muted/50`
              — nền alpha ở hàng tiêu đề là ô cột ghim `bg-inherit` lộ hàng bên dưới.
            */}
            <TableRow ref={headerRowRef} className="bg-row-head hover:bg-row-head">
              {visibleColumns.map((column) => (
                <ColumnHeaderCell
                  key={column.key}
                  column={column}
                  width={widthOf(column)}
                  minWidth={column.minWidth ?? LINE_COLUMN_MIN_WIDTH}
                  className={cn(
                    HEAD_CELL,
                    alignClass(column.align),
                    pinClass(column.key),
                  )}
                  colorStyle={columnColorStyle(columnColors[column.key], 'head')}
                  pinnedOffset={pinnedOffsets[column.key]}
                  dragging={drag?.fromKey === column.key}
                  onResize={(next) => setColumnWidth(column.key, next)}
                  onDragStart={(event) => startDrag(event, column.key, columnLabel(column.header))}
                />
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={visibleColumns.length}
                  className="h-20 px-3 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}

            {rows.map((row, index) => (
              <TableRow
                key={rowKey(row, index)}
                className={cn(ROW_BG, rowClassName?.(row, index))}
              >
                {visibleColumns.map((column) => (
                  <TableCell
                    key={column.key}
                    style={{
                      width: widthOf(column),
                      left: pinnedOffsets[column.key],
                      // Màu cột đặt SAU nền hàng: ô đã tô giữ nguyên màu kể cả
                      // khi rê chuột, đúng ý "đánh dấu cột".
                      ...columnColorStyle(columnColors[column.key], 'cell'),
                    }}
                    className={cn(
                      BODY_CELL,
                      alignClass(column.align),
                      cellClassName?.(column.key, row, index),
                      pinClass(column.key),
                      // Cột đang bay theo con trỏ thì bản gốc mờ đi —
                      // xem ghi chú ở `column-header-cell.tsx`.
                      drag?.fromKey === column.key && 'opacity-40',
                    )}
                  >
                    <div
                      className={cn(
                        column.wrap === false
                          ? 'truncate'
                          : 'break-words whitespace-normal leading-snug',
                      )}
                    >
                      {(() => {
                        const content = renderCell(column.key, row, index)
                        return typeof content === 'string' && (content === '—' || content === '-')
                          ? ''
                          : content
                      })()}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Lớp phủ lúc kéo cột — vẽ vào `body` để không bị khung viền
          `overflow-hidden` của bảng cắt mất. */}
      {drag && <ColumnDragOverlay drag={drag} />}
    </div>
  )
}

function alignClass(align: LinesTableColumn['align']) {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return undefined
}
