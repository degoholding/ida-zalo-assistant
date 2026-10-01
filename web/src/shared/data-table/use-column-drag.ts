import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import { captureColumnSnapshot } from './capture-column-snapshot'
import type { ColumnDropSide } from './types'

/** Đi quá ngần này pixel mới tính là kéo — dưới đó vẫn là một cú bấm. */
const DRAG_THRESHOLD = 4

/**
 * Số đo để `column-drag-overlay.tsx` vẽ lớp phủ. Tất cả là TOẠ ĐỘ MÀN HÌNH
 * (viewport) vì lớp phủ vẽ vào `<body>` bằng `position: fixed`.
 */
export interface ColumnDragGeometry {
  /** Bề rộng cột đang bê — bản sao vẽ đúng bằng bề rộng thật của nó. */
  width: number
  /** Vùng dọc của bảng đang NHÌN THẤY, đã cắt theo khung cuộn. */
  top: number
  bottom: number
  /**
   * Mép trái của bản sao đang bay. Bằng con trỏ trừ đi ĐÚNG chỗ đã nắm trong ô
   * tiêu đề, như dnd-kit: nắm ở đâu thì chỗ đó nằm dưới con trỏ suốt lúc kéo,
   * không giật về giữa cột ngay khi vừa nhấc tay.
   */
  ghostLeft: number
  /** Mép trái cột nguồn, để vẽ ô trống ngay chỗ nó vừa được nhấc lên. */
  fromLeft: number
  /** Hoành độ khe sẽ chèn; `null` khi con trỏ chưa trỏ vào cột nào. */
  dropX: number | null
  /** Ô tiêu đề cột đích, để tô sáng nguyên cột; `null` khi chưa có đích. */
  overLeft: number | null
  overWidth: number | null
}

export interface ColumnDragState {
  fromKey: string
  /** Tên cột — dùng khi không chụp được bản sao (bảng rỗng, cột vừa bị gỡ). */
  label: string
  /** Bản sao của cột để lớp phủ bê theo con trỏ; `null` thì rơi về nhãn chữ. */
  snapshot: HTMLTableElement | null
  /** Cột đang trỏ tới và sẽ chèn vào trước/sau nó. */
  overKey: string | null
  side: ColumnDropSide | null
  x: number
  y: number
  geometry: ColumnDragGeometry
}

/**
 * Kéo thả đổi thứ tự cột bằng POINTER EVENT, không dùng HTML5 drag-and-drop.
 *
 * HTML5 DnD để trình duyệt tự chụp ảnh ô tiêu đề làm ảnh kéo, ảnh đó nhòe và trễ
 * một nhịp so với con trỏ; lại còn xung khắc với vạch kéo giãn nằm cùng ô. Pointer
 * event cho phép tự vẽ chỉ báo, chạy mượt theo từng khung hình và dùng được trên
 * cảm ứng — cùng cơ chế với `column-resize-handle.tsx`.
 */
export function useColumnDrag(
  onReorder: (fromKey: string, toKey: string, side: ColumnDropSide) => void,
) {
  const [drag, setDrag] = useState<ColumnDragState | null>(null)
  const dragRef = useRef<ColumnDragState | null>(null)

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLTableCellElement>, key: string, label: string) => {
      // Chỉ chuột trái; bấm trúng vạch kéo giãn thì đó là đổi ĐỘ RỘNG.
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('[role="separator"]')) return

      const row = event.currentTarget.closest('tr')
      if (!row) return

      const startX = event.clientX
      // Nắm cách mép trái ô tiêu đề bao nhiêu — giữ nguyên khoảng đó dưới con trỏ.
      const grabOffset = startX - event.currentTarget.getBoundingClientRect().left
      let moved = false
      let snapshot: HTMLTableElement | null = null

      const handleMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD) return
        if (!moved) {
          moved = true
          // Kéo ngang qua cả bảng mà không bôi đen chữ trong ô tiêu đề.
          document.body.classList.add('select-none', 'cursor-grabbing')
          // Nhãn cột nay CHO bôi đen (`column-header-cell.tsx`) nên 4px đầu tiên
          // của cú kéo kịp quét xanh một mẩu chữ trước khi `select-none` khóa
          // lại; xoá đi kẻo vệt xanh đó dính trên ô nguồn suốt lúc kéo.
          window.getSelection()?.removeAllRanges()
          // Chụp một lần lúc bắt đầu kéo, không chụp lại mỗi khung hình: nội
          // dung cột không đổi trong lúc kéo, mà `cloneNode` cả chục dòng thì
          // không rẻ.
          snapshot = captureColumnSnapshot(row, key)
        }

        const cells = headerCells(row)
        const target = columnUnder(cells, moveEvent.clientX)
        const source = cells.find((cell) => cell.dataset.columnKey === key)
        const sourceBox = source?.getBoundingClientRect()
        const span = verticalSpan(row)

        const next: ColumnDragState = {
          fromKey: key,
          label,
          snapshot,
          overKey: target?.key ?? null,
          side: target?.side ?? null,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          geometry: {
            width: sourceBox?.width ?? 0,
            top: span.top,
            bottom: span.bottom,
            ghostLeft: moveEvent.clientX - grabOffset,
            fromLeft: sourceBox?.left ?? 0,
            dropX: target?.dropX ?? null,
            overLeft: target?.left ?? null,
            overWidth: target?.width ?? null,
          },
        }
        dragRef.current = next
        setDrag(next)
      }

      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
        document.body.classList.remove('select-none', 'cursor-grabbing')

        const finished = dragRef.current
        dragRef.current = null
        setDrag(null)

        if (finished?.overKey && finished.side && finished.overKey !== finished.fromKey) {
          onReorder(finished.fromKey, finished.overKey, finished.side)
        }
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [onReorder],
  )

  // Bảng biến mất giữa lúc đang kéo (chuyển trang, mở hộp thoại) thì `pointerup`
  // có thể không bao giờ tới, `select-none` kẹt lại trên <body> và CẢ TRANG hết
  // bôi đen được — kể cả chữ trong popup. Gỡ chốt lúc tháo component.
  useEffect(
    () => () => document.body.classList.remove('select-none', 'cursor-grabbing'),
    [],
  )

  return { drag, startDrag }
}

function headerCells(row: Element): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('th[data-column-key]')]
}

/**
 * Vùng dọc mà lớp phủ được phép vẽ: phần giao giữa bảng và khung cuộn bao ngoài.
 * Không cắt theo khung cuộn thì bảng dài hơn khung (chế độ `fillHeight`, tiêu đề
 * dính đỉnh) sẽ có bóng cột thò ra ngoài viền, đè lên cả phân trang bên dưới.
 */
function verticalSpan(row: Element): { top: number; bottom: number } {
  const table = row.closest('table')
  if (!table) return { top: 0, bottom: 0 }

  const box = table.getBoundingClientRect()
  const frame = row.closest('[data-slot="table-container"]')?.getBoundingClientRect()
  return {
    top: Math.max(box.top, frame?.top ?? box.top),
    bottom: Math.min(box.bottom, frame?.bottom ?? box.bottom),
  }
}

/**
 * Cột nằm dưới hoành độ `x`, kèm việc sẽ chèn vào nửa trái (before) hay nửa phải
 * (after). Ra ngoài hai mép bảng thì bám vào cột đầu / cột cuối để thả ở rìa vẫn ăn.
 */
function columnUnder(
  cells: HTMLElement[],
  x: number,
): { key: string; side: ColumnDropSide; left: number; width: number; dropX: number } | null {
  if (cells.length === 0) return null

  for (const cell of cells) {
    const box = cell.getBoundingClientRect()
    if (x < box.left || x > box.right) continue
    const side: ColumnDropSide = x < box.left + box.width / 2 ? 'before' : 'after'
    return {
      key: cell.dataset.columnKey as string,
      side,
      left: box.left,
      width: box.width,
      dropX: side === 'before' ? box.left : box.right,
    }
  }

  const first = cells[0].getBoundingClientRect()
  if (x < first.left) {
    return {
      key: cells[0].dataset.columnKey as string,
      side: 'before',
      left: first.left,
      width: first.width,
      dropX: first.left,
    }
  }

  const last = cells[cells.length - 1]
  const box = last.getBoundingClientRect()
  return {
    key: last.dataset.columnKey as string,
    side: 'after',
    left: box.left,
    width: box.width,
    dropX: box.right,
  }
}
