import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/**
 * Bề rộng màn hình có đang ở ngưỡng mobile không.
 *
 * Dùng `useSyncExternalStore` thay cho cặp `useState` + `useEffect`: đây là API
 * React dành riêng cho việc đọc trạng thái từ NGOÀI React (ở đây là media
 * query). Bản cũ khởi tạo `undefined` rồi mới set trong effect nên lượt render
 * đầu luôn trả `false` — trên màn hình nhỏ sẽ nháy layout desktop một nhịp.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false, // Không có `window` (prerender): mặc định desktop.
  )
}
