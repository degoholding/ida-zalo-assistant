import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

import { RequiredMark } from '@/shared/ui/required-mark'
import { TableHead } from '@/shared/ui/table'
import { cn } from '@/shared/utils/cn'
import { ColumnResizeHandle } from './column-resize-handle'
import { splitRequiredHeader } from './required-header'
import type { DataTableColumn } from './types'

interface ColumnHeaderCellProps<T> {
  column: DataTableColumn<T>
  width?: number
  className?: string
  minWidth: number
  /** Ô này đang được kéo đi. */
  dragging?: boolean
  /** `false` với cột thao tác cố định bên phải: vẫn cho đổi độ rộng, không cho dời. */
  draggable?: boolean
  /** Cột đang ghim: khoảng cách dính tính từ mép trái bảng. */
  pinnedOffset?: number
  /** Cột thao tác cố định: khoảng cách dính tính từ mép phải bảng. */
  pinnedRightOffset?: number
  /** Bỏ vạch phải khi ô kế tiếp đã tự vẽ vạch trái (tránh hai border sát nhau). */
  suppressRightDivider?: boolean
  /** Nền của cột do người dùng tự tô (xem `column-color-palette.ts`). */
  colorStyle?: CSSProperties
  sortDir?: 'asc' | 'desc' | null
  onSort?: () => void
  onResize: (width: number) => void
  onDragStart: (event: ReactPointerEvent<HTMLTableCellElement>) => void
}

/**
 * Người dùng có đang bôi đen chữ NẰM TRONG ô tiêu đề này không.
 *
 * Phải xét cả chỗ chứa vệt bôi đen chứ không chỉ hỏi "có bôi đen không": vệt đó
 * có thể nằm ở một ô khác từ lúc nãy và chưa bị xoá, chặn theo kiểu đó thì bấm
 * mũi tên sắp xếp không ăn mà chẳng hiểu vì sao.
 */
function hasSelectionInside(element: Element): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false

  const { anchorNode, focusNode } = selection
  return (
    (anchorNode !== null && element.contains(anchorNode)) ||
    (focusNode !== null && element.contains(focusNode))
  )
}

/**
 * Ô tiêu đề: nhãn cột + bắt đầu kéo đổi vị trí + nút sắp xếp + vạch kéo giãn ở mép phải.
 */
export function ColumnHeaderCell<T>({
  column,
  width,
  className,
  minWidth,
  dragging,
  draggable = true,
  pinnedOffset,
  pinnedRightOffset,
  suppressRightDivider = false,
  colorStyle,
  sortDir,
  onSort,
  onResize,
  onDragStart,
}: ColumnHeaderCellProps<T>) {
  const [resizing, setResizing] = useState(false)
  const { label, required } = splitRequiredHeader(column.header)

  const isSortable = Boolean(column.sortable && onSort)

  return (
    <TableHead
      data-column-key={column.key}
      style={{
        width,
        left: pinnedOffset,
        right: pinnedRightOffset,
        ...(suppressRightDivider ? { boxShadow: 'inset 0 -1px 0 0 var(--border)' } : undefined),
        ...colorStyle,
      }}
      className={cn(
        'transition-[opacity,box-shadow] duration-150 select-none',
        //  ⚠️ Vạch kéo giãn thò 4px ra ngoài mép phải ô (`-right-1`) để dễ trúng
        //  tay. Ở CỘT CUỐI, 4px đó thò ra ngoài cả bảng — khung cuộn đếm nó vào
        //  `scrollWidth` và vẽ một thanh cuộn ngang cao 8px cho đúng 4px không
        //  có gì để xem. Bảng vốn tràn thì chẳng ai nhận ra, nhưng bảng vừa khít
        //  màn (Quỹ phép năm, 19/09/2026) thì đó là một dải xám thừa nằm dưới
        //  hàng cuối. Cột cuối kéo giãn sang phải cũng không còn gì để kéo nên
        //  ép nó phẳng mép không mất gì.
        'last:[&>[role=separator]]:right-0',
        resizing
          ? 'cursor-col-resize'
          : draggable
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-default',
        // Ô nguồn MỜ chứ không tàng hình: ẩn hẳn thì chỗ cũ thành một ô trắng
        // trơn trông như bảng đang tải dở, mà người dùng vẫn cần đọc được cột
        // mình đang bê vốn nằm ở đâu, dữ liệu gì.
        dragging && 'opacity-40',
        className,
      )}
      onPointerDown={draggable ? onDragStart : undefined}
    >
      <div
        className={cn(
          'flex items-center gap-1 overflow-hidden transition-colors',
          //  Chỉ canh giữa/phải cho ô tiêu đề TỰ VẼ (`headerContent`). Nhãn chữ
          //  thường thì để nguyên canh trái như xưa: `text-*` trên `<th>` không
          //  ăn vào con của flex, nên thêm `justify-*` ở đây là đổi diện mạo tiêu
          //  đề của mọi cột tiền/ngày trên toàn hệ — việc khác, đừng gộp vào đây.
          column.headerContent && column.align === 'center' && 'justify-center',
          column.headerContent && column.align === 'right' && 'justify-end',
          isSortable && 'cursor-pointer hover:text-foreground',
        )}
        onClick={(e) => {
          if (!isSortable) return
          // Vừa bôi đen tên cột để chép thì cú nhả chuột đó KHÔNG phải lệnh sắp
          // xếp — không chặn thì mỗi lần chép tên cột là bảng nhảy thứ tự, mà
          // nháy đúp (chọn cả từ) còn sắp xếp hai lần liền.
          if (hasSelectionInside(e.currentTarget)) return
          e.stopPropagation()
          onSort?.()
        }}
      >
        {/* `select-text` chọc thủng `select-none` của ô: TÊN CỘT phải bôi đen và
            chép được. Người dùng thường xuyên chép tên cột ra Excel / đi hỏi lại,
            mà cả bảng khóa chọn thì chép kiểu gì cũng không ra (khách báo
            31/08/2026). Chỉ mở đúng cái nhãn, phần đệm còn lại của ô vẫn khóa để
            kéo đổi vị trí cột không quét xanh cả hàng tiêu đề. */}
        {column.headerContent ? (
          //  Ô tiêu đề tự vẽ (ô tick "chọn hết"…). Phải chặn CẢ HAI sự kiện:
          //  `pointerdown` là lệnh bắt đầu kéo đổi vị trí cột (bấm vào ô tick mà
          //  không chặn thì cả cột bay theo con trỏ), còn `click` là lệnh sắp xếp
          //  của lớp bọc ngay bên ngoài.
          <span
            className="flex items-center"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {column.headerContent}
          </span>
        ) : (
          <span className="truncate select-text">
            {label}
            {required && <RequiredMark />}
          </span>
        )}

        {isSortable && (
          <span className="shrink-0 text-muted-foreground">
            {sortDir === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5 text-primary" />
            ) : sortDir === 'desc' ? (
              <ArrowDown className="h-3.5 w-3.5 text-primary" />
            ) : (
              <ArrowUpDown className="h-3.5 w-3.5 opacity-40 hover:opacity-100" />
            )}
          </span>
        )}
      </div>

      <ColumnResizeHandle minWidth={minWidth} onResize={onResize} onResizingChange={setResizing} />
    </TableHead>
  )
}
