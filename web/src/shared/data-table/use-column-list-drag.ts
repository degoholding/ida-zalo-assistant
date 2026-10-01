import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { ColumnDropSide } from './types'

/** Đi quá ngần này pixel mới tính là kéo — dưới đó vẫn là một cú bấm. */
const DRAG_THRESHOLD = 4

export interface ColumnListDragState {
  fromKey: string
  /** Nhãn hiện trên "viên" bám theo con trỏ. */
  label: string
  /** Dòng đang trỏ tới và sẽ chèn vào trên (`before`) / dưới (`after`) nó. */
  overKey: string | null
  side: ColumnDropSide | null
  x: number
  y: number
}

/**
 * Kéo thả đổi thứ tự cột trong DANH SÁCH DỌC (menu "Cột").
 *
 * Cùng cơ chế pointer event như `use-column-drag.ts` (kéo trên chính hàng tiêu
 * đề bảng) nhưng tính theo trục DỌC. Không dùng HTML5 drag-and-drop: menu của
 * Radix quản lý focus và tự đóng khi con trỏ đi lạc, còn ảnh kéo mặc định thì
 * nhòe và trễ nhịp.
 *
 * Dòng phải nằm trong một khối có `data-column-list` và mỗi dòng mang
 * `data-column-key`.
 */
export function useColumnListDrag(
  onReorder: (fromKey: string, toKey: string, side: ColumnDropSide) => void,
) {
  const [drag, setDrag] = useState<ColumnListDragState | null>(null)
  const dragRef = useRef<ColumnListDragState | null>(null)

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, key: string, label: string) => {
      if (event.button !== 0) return
      // Chặn menu giành lại focus / bôi đen chữ trong lúc kéo.
      event.preventDefault()
      event.stopPropagation()

      const list = event.currentTarget.closest('[data-column-list]')
      if (!list) return

      const startY = event.clientY
      let moved = false

      const handleMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD) return
        moved = true

        const target = rowUnder(list, moveEvent.clientY)
        const next: ColumnListDragState = {
          fromKey: key,
          label,
          overKey: target?.key ?? null,
          side: target?.side ?? null,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        }
        dragRef.current = next
        setDrag(next)
      }

      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)

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

  return { drag, startDrag }
}

/**
 * Dòng nằm dưới tung độ `y`, kèm việc sẽ chèn vào nửa trên (before) hay nửa dưới
 * (after). Ra ngoài hai đầu danh sách thì bám vào dòng đầu / dòng cuối để thả ở
 * rìa vẫn ăn.
 */
function rowUnder(
  list: Element,
  y: number,
): { key: string; side: ColumnDropSide } | null {
  const rows = [...list.querySelectorAll<HTMLElement>('[data-column-key]')]
  if (rows.length === 0) return null

  for (const row of rows) {
    const box = row.getBoundingClientRect()
    if (y < box.top || y > box.bottom) continue
    return {
      key: row.dataset.columnKey as string,
      side: y < box.top + box.height / 2 ? 'before' : 'after',
    }
  }

  const first = rows[0].getBoundingClientRect()
  if (y < first.top) return { key: rows[0].dataset.columnKey as string, side: 'before' }

  const last = rows[rows.length - 1]
  return { key: last.dataset.columnKey as string, side: 'after' }
}
