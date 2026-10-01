import { useCallback, useState } from 'react'

const STORAGE_KEY = 'erp.sidebar-width'

/** Hẹp hơn nữa thì nhãn menu dài bị cắt; rộng hơn thì lấn hết chỗ nội dung. */
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 420
/** 16rem — đúng mặc định của shadcn. */
export const SIDEBAR_DEFAULT_WIDTH = 256

/**
 * Bề rộng menu trái do người dùng kéo chỉnh, nhớ lại giữa các phiên.
 *
 * Giá trị được đổ vào biến CSS `--sidebar-width` của `SidebarProvider`; trong
 * lúc kéo thì ghi thẳng lên biến đó cho mượt, thả chuột mới gọi `setWidth` để
 * chốt vào state + localStorage (xem `sidebar-resize-handle.tsx`).
 */
export function useSidebarWidth() {
  const [width, setWidthState] = useState(readStoredWidth)

  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next)
    setWidthState(clamped)
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped))
    } catch {
      // Trình duyệt chặn storage: vẫn kéo được, chỉ là không nhớ sang phiên sau.
    }
  }, [])

  return { width, setWidth }
}

export function clampWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) ? clampWidth(parsed) : SIDEBAR_DEFAULT_WIDTH
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}
