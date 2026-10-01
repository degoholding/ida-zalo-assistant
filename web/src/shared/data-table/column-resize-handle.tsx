import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

import { measureColumnContentWidth } from './measure-column-width'

interface ColumnResizeHandleProps {
  minWidth: number
  /** Chặn trên khi tự vừa nội dung; mặc định 640px cho khỏi có cột dài cả màn. */
  maxWidth?: number
  onResize: (width: number) => void
  /**
   * Báo cho ô tiêu đề biết đang kéo giãn để nó TẮT `draggable` — ô tiêu đề vừa
   * kéo thả đổi vị trí vừa kéo giãn, không tắt thì trình duyệt nuốt mất chuỗi
   * pointer event và biến cú kéo giãn thành cú kéo cả cột đi chỗ khác.
   */
  onResizingChange?: (resizing: boolean) => void
}

/**
 * Vạch kéo ở mép phải ô tiêu đề để chỉnh độ rộng cột.
 *
 * Dùng Pointer Events + `setPointerCapture`: chuột đi ra ngoài vạch, ra ngoài
 * cả cửa sổ vẫn nhận được sự kiện, nên không có cảnh "kéo hụt rồi cột kẹt".
 * Chỉ báo độ rộng mới ra ngoài khi THẢ chuột — cập nhật theo từng pixel sẽ ghi
 * localStorage hàng trăm lần cho một cú kéo.
 */
export function ColumnResizeHandle({
  minWidth,
  maxWidth,
  onResize,
  onResizingChange,
}: ColumnResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null)
  /** Mốc thời gian lần nhấn trước — dùng để tự bắt cú nháy đúp (xem dưới). */
  const lastDownRef = useRef(0)

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Ngăn click lan lên <th> (kẻo trang lại hiểu là bấm vào tiêu đề để sắp xếp).
    event.preventDefault()
    event.stopPropagation()

    // `preventDefault` ở pointerdown làm trình duyệt NUỐT LUÔN sự kiện
    // `dblclick`, nên phải tự đo khoảng cách giữa hai lần nhấn.
    const now = event.timeStamp
    const isDoubleClick = now - lastDownRef.current < 350
    lastDownRef.current = now
    if (isDoubleClick) {
      lastDownRef.current = 0
      autoFit(event.currentTarget)
      return
    }

    const handle = event.currentTarget
    // Đo độ rộng THẬT của ô lúc này thay vì tin vào prop: cột chưa khai `width`
    // hoặc đang bị bảng co giãn thì con số trong state không khớp thực tế.
    const startWidth = handle.closest('th')?.getBoundingClientRect().width ?? minWidth

    handle.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth, width: startWidth }
    onResizingChange?.(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return

    const width = Math.max(minWidth, drag.startWidth + event.clientX - drag.startX)
    drag.width = width

    // Sửa thẳng DOM trong lúc kéo để mượt, không đụng tới React state.
    const cell = event.currentTarget.closest('th')
    if (cell) cell.style.width = `${width}px`
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    dragRef.current = null
    onResizingChange?.(false)
    if (!drag) return

    event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.width !== drag.startWidth) onResize(drag.width)
  }

  /**
   * Nháy đúp = tự co/giãn vừa nội dung (thói quen từ Excel). Đo xong đặt luôn
   * vào DOM cho mượt rồi mới báo ra ngoài, giống lúc kéo tay.
   */
  function autoFit(handle: HTMLDivElement) {
    const cell = handle.closest('th')
    const table = cell?.closest('table')
    if (!cell || !table) return

    const columnIndex = Array.from(cell.parentElement?.children ?? []).indexOf(cell)
    if (columnIndex < 0) return

    const width = measureColumnContentWidth(table, columnIndex, {
      min: minWidth,
      max: maxWidth,
    })
    cell.style.width = `${width}px`
    onResize(width)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Kéo để đổi độ rộng cột, nháy đúp để vừa nội dung"
      title="Kéo để đổi độ rộng · Nháy đúp để vừa nội dung"
      onDoubleClick={(event) => autoFit(event.currentTarget)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none before:absolute before:inset-y-1 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent hover:before:bg-primary"
    />
  )
}
