import { Columns3, Eye, EyeOff, GripVertical, Pin, PinOff, RotateCcw, Scaling } from 'lucide-react'
import { createPortal } from 'react-dom'

import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { cn } from '@/shared/utils/cn'
import { ColumnColorMenu } from './column-color-menu'
import { columnLabel } from './required-header'
import type { ColumnDropSide, DataTableColumn } from './types'
import { useColumnListDrag } from './use-column-list-drag'

interface ColumnVisibilityMenuProps<T> {
  columns: DataTableColumn<T>[]
  hiddenColumns: string[]
  pinnedColumns: string[]
  columnColors: Record<string, string>
  onToggle: (key: string) => void
  onTogglePin: (key: string) => void
  /** Co giãn MỌI cột đang hiện cho vừa nội dung. */
  onAutoFitAll: () => void
  onColorChange: (key: string, colorId: string) => void
  /** Đổi thứ tự cột — kéo thả ngay trong danh sách này. */
  onMove: (fromKey: string, toKey: string, side: ColumnDropSide) => void
  onReset: () => void
}

const ICON_BUTTON =
  'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

/**
 * Menu tùy biến cột: KÉO THẢ đổi thứ tự, bật/tắt hiển thị, GHIM sang trái (dính
 * khi cuộn ngang), co giãn vừa nội dung và tô màu từng cột, kèm nút trả bảng về
 * mặc định.
 *
 * Không dùng `DropdownMenuCheckboxItem`: mỗi dòng có nhiều nút bấm độc lập,
 * nhét vào một mục "chọn được" thì bấm chỗ nào cũng thành tick ẩn/hiện.
 */
export function ColumnVisibilityMenu<T>({
  columns,
  hiddenColumns,
  pinnedColumns,
  columnColors,
  onToggle,
  onTogglePin,
  onAutoFitAll,
  onColorChange,
  onMove,
  onReset,
}: ColumnVisibilityMenuProps<T>) {
  const { drag, startDrag } = useColumnListDrag(onMove)

  if (columns.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Chỉ chữ "Cột": số cột đang ẩn/ghim đã thấy ngay trong menu, đưa lên
            nút chỉ làm nhãn dài ra mà không giúp quyết định gì. */}
        <Button variant="outline">
          <Columns3 />
          Cột
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between font-normal text-muted-foreground">
          <span>Kéo để đổi thứ tự</span>
          <span>Màu · Ghim</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/*
          Bảng nhiều cột (Tiến độ mua hàng ~24 cột) -> danh sách tự cuộn.
          `data-column-list` là mốc để `useColumnListDrag` dò dòng đang bị trỏ tới.
        */}
        <div data-column-list className="max-h-80 overflow-y-auto">
          {columns.map((column) => {
            const hidden = hiddenColumns.includes(column.key)
            const fixedRight = column.stickyRight === true
            const pinned = !fixedRight && pinnedColumns.includes(column.key)
            // Cột `hideable: false` luôn phải hiện -> khóa nút ẩn, vẫn cho ghim.
            const canHide = column.hideable !== false
            const dropSide = drag?.overKey === column.key ? drag.side : null

            return (
              <div
                key={column.key}
                data-column-key={column.key}
                className={cn(
                  'flex items-center gap-0.5 rounded-sm px-2 py-1 transition-colors hover:bg-accent',
                  drag?.fromKey === column.key && 'opacity-40',
                  // Vạch báo chỗ sắp thả, vẽ bằng `inset shadow` để không đẩy
                  // các dòng khác xê dịch trong lúc kéo.
                  dropSide === 'before' && 'shadow-[inset_0_2px_0_0_var(--primary)]',
                  dropSide === 'after' && 'shadow-[inset_0_-2px_0_0_var(--primary)]',
                )}
              >
                {/*
                  Tay nắm riêng thay vì kéo cả dòng: cả dòng đều là nút bấm
                  (ẩn/hiện, màu, ghim), cho kéo ở mọi chỗ thì mỗi cú bấm hụt vài
                  pixel lại thành đổi thứ tự.
                */}
                <button
                  type="button"
                  disabled={fixedRight}
                  title={fixedRight ? 'Cột này luôn nằm cuối bảng' : 'Kéo để đổi thứ tự cột'}
                  onPointerDown={
                    fixedRight
                      ? undefined
                      : (event) => startDrag(event, column.key, columnLabel(column.header))
                  }
                  className={cn(
                    ICON_BUTTON,
                    'size-6 cursor-grab touch-none active:cursor-grabbing',
                  )}
                >
                  <GripVertical className="size-4" />
                </button>

                <button
                  type="button"
                  disabled={!canHide}
                  onClick={() => onToggle(column.key)}
                  title={canHide ? 'Ẩn / hiện cột' : 'Cột này luôn hiển thị'}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    hidden && 'text-muted-foreground',
                  )}
                >
                  {hidden ? (
                    <EyeOff className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Eye className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  {/* Menu này là danh sách TÊN cột — dấu sao bắt buộc chỉ có
                      nghĩa ở tiêu đề bảng, đưa vào đây chỉ làm rối. */}
                  <span className="truncate">{columnLabel(column.header)}</span>
                </button>

                <ColumnColorMenu
                  colorId={columnColors[column.key]}
                  triggerClassName={ICON_BUTTON}
                  onChange={(colorId) => onColorChange(column.key, colorId)}
                />

                <button
                  type="button"
                  disabled={fixedRight}
                  onClick={() => onTogglePin(column.key)}
                  title={
                    fixedRight
                      ? 'Cột này được cố định bên phải'
                      : pinned
                        ? 'Bỏ ghim cột'
                        : 'Ghim cột sang trái'
                  }
                  aria-pressed={pinned}
                  className={cn(ICON_BUTTON, pinned && 'bg-background text-primary')}
                >
                  {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                </button>
              </div>
            )
          })}
        </div>

        <DropdownMenuSeparator />
        {/* Một nút cho CẢ BẢNG: chỉnh từng cột một thì đã có cách nhanh hơn —
            nháy đúp vào vạch kéo giãn ngay trên tiêu đề cột đó. */}
        <DropdownMenuItem onSelect={onAutoFitAll}>
          <Scaling />
          Vừa nội dung tất cả cột
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReset}>
          <RotateCcw />
          Khôi phục mặc định
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/*
        "Viên" bám theo con trỏ trong lúc kéo. Đưa thẳng ra `body` bằng portal:
        để bên trong menu thì nó bị khung menu cắt mất khi kéo ra ngoài, và
        `overflow-y-auto` của danh sách cũng xén nốt.
      */}
      {drag &&
        createPortal(
          <div
            className="pointer-events-none fixed z-100 flex translate-x-3 -translate-y-1/2 items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
            style={{ left: drag.x, top: drag.y }}
          >
            <GripVertical className="size-3.5 text-muted-foreground" />
            {drag.label}
          </div>,
          document.body,
        )}
    </DropdownMenu>
  )
}
