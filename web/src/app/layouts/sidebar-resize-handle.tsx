import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

import { useSidebar } from '@/shared/ui/sidebar'
import { cn } from '@/shared/utils/cn'
import { clampWidth } from './use-sidebar-width'

/** Kéo dưới ngưỡng này coi như bấm nhầm, không tính là kéo. */
const DRAG_THRESHOLD_PX = 3

interface SidebarResizeHandleProps {
  onResize: (width: number) => void
}

/**
 * Vạch ở mép phải menu trái, thay cho `SidebarRail` mặc định:
 *  • KÉO  -> đổi bề rộng menu.
 *  • BẤM  -> thu/mở menu (giữ nguyên hành vi cũ của rail).
 *
 * Gộp hai thao tác vào một vạch thay vì bày hai chỗ bấm chồng lên nhau ở cùng
 * một mép. Khi menu đang thu gọn thì chỉ còn tác dụng bấm — kéo giãn thanh
 * icon 48px không có ý nghĩa gì.
 */
export function SidebarResizeHandle({ onResize }: SidebarResizeHandleProps) {
  const { state, toggleSidebar } = useSidebar()
  const collapsed = state === 'collapsed'

  const dragRef = useRef<{
    startX: number
    startWidth: number
    width: number
    moved: boolean
    wrapper: HTMLElement | null
  } | null>(null)

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (collapsed) return

    const handle = event.currentTarget
    const wrapper = handle.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
    const sidebar = handle.closest<HTMLElement>('[data-slot="sidebar"]')
    const startWidth =
      sidebar?.getBoundingClientRect().width ?? clampWidth(0)

    handle.setPointerCapture(event.pointerId)
    // Tắt transition trong lúc kéo, nếu không mép menu chạy trễ sau con trỏ.
    wrapper?.setAttribute('data-sidebar-resizing', 'true')
    dragRef.current = {
      startX: event.clientX,
      startWidth,
      width: startWidth,
      moved: false,
      wrapper,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag) return

    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > DRAG_THRESHOLD_PX) drag.moved = true

    const width = clampWidth(drag.startWidth + delta)
    drag.width = width
    // Ghi thẳng lên biến CSS cho mượt; chốt vào React state khi thả chuột.
    drag.wrapper?.style.setProperty('--sidebar-width', `${width}px`)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    event.currentTarget.releasePointerCapture(event.pointerId)
    drag.wrapper?.removeAttribute('data-sidebar-resizing')

    if (drag.moved) onResize(drag.width)
    else toggleSidebar()
  }

  return (
    <button
      type="button"
      data-slot="sidebar-rail"
      aria-label={collapsed ? 'Mở rộng menu' : 'Kéo để đổi bề rộng menu, bấm để thu gọn'}
      title={collapsed ? 'Mở rộng menu' : 'Kéo để đổi bề rộng · Bấm để thu gọn'}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={collapsed ? toggleSidebar : undefined}
      className={cn(
        'absolute inset-y-0 -right-2 z-20 hidden w-4 touch-none select-none sm:block',
        // Vạch mảnh hiện khi rê chuột vào, giống rail gốc của shadcn.
        'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 hover:after:bg-sidebar-border',
        collapsed ? 'cursor-e-resize' : 'cursor-col-resize',
      )}
    />
  )
}
