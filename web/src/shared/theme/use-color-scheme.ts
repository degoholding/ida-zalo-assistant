import { useSyncExternalStore } from 'react'

/**
 * Chế độ nền ĐANG CÓ HIỆU LỰC (`light` | `dark`), đọc thẳng từ class trên thẻ
 * `<html>`.
 *
 * Vì sao không dùng `useTheme()` của `next-themes`: nó trả về Ý ĐỊNH của người
 * dùng (`system` | `light` | `dark`), còn `resolvedTheme` thì `undefined` ở
 * khung hình đầu — muốn dùng phải kèm cờ `mounted` set trong `useEffect`, mà đó
 * đúng là kiểu `setState` trong effect mà `react-hooks` cảnh báo, và vẫn nháy
 * một nhịp sai màu.
 *
 * Class `.dark` trên `<html>` mới là NGUỒN THẬT — chính nó quyết định khối CSS
 * nào có hiệu lực. Nó là trạng thái nằm ngoài React nên `useSyncExternalStore`
 * là đúng công cụ: đọc đồng bộ ngay khung hình đầu, và `MutationObserver` bắt
 * mọi lần đổi kể cả khi `next-themes` đổi ngầm theo thiết lập của máy.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function getSnapshot(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** Dùng khi cần VẼ theo màu của một chế độ nền, ví dụ thẻ xem trước bảng màu. */
export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light')
}
