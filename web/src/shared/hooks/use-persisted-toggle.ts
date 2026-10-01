import { useCallback, useState } from 'react'

/**
 * Một công tắc bật/tắt nhớ lại giữa các phiên.
 *
 * Dùng cho những lựa chọn về CÁCH BÀY MÀN HÌNH (thu gọn cột, ẩn khối phụ): đã
 * thu gọn một lần thì lần sau mở lại phải thấy y như lúc rời đi, chứ không bắt
 * thu gọn lại mỗi lần vào trang.
 */
export function usePersistedToggle(storageKey: string, defaultValue = false) {
  const [bat, datBat] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw === null ? defaultValue : raw === '1'
    } catch {
      //  Trình duyệt chặn storage: vẫn bấm được, chỉ là không nhớ sang phiên sau.
      return defaultValue
    }
  })

  const toggle = useCallback(() => {
    datBat((truoc) => {
      const latest = !truoc
      try {
        localStorage.setItem(storageKey, latest ? '1' : '0')
      } catch {
        //  bỏ qua
      }
      return latest
    })
  }, [storageKey])

  return [bat, toggle] as const
}
