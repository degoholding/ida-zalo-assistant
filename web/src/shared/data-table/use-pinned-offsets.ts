import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Mốc `left` của từng cột ghim, ĐO TỪ DOM chứ không cộng `width` khai báo.
 *
 * Bảng chạy `table-fixed` nhưng vẫn chia phần dư cho các cột khi tổng bề rộng
 * nhỏ hơn khung, nên bề rộng thật thường lớn hơn con số khai trong cấu hình.
 * Cộng theo số khai thì cột ghim thứ hai nằm lệch, để hở một vệt nội dung đang
 * cuộn phía dưới.
 *
 * Đo lại khi: đổi danh sách cột ghim, người dùng kéo giãn cột, hoặc khung bảng
 * đổi bề rộng (thu/mở menu trái, đổi cỡ cửa sổ).
 */
export function usePinnedOffsets(pinnedKeys: string[], pinnedRightKeys: string[] = []) {
  const headerRowRef = useRef<HTMLTableRowElement>(null)
  const [offsets, setOffsets] = useState<Record<string, number>>({})
  const [rightOffsets, setRightOffsets] = useState<Record<string, number>>({})
  const [scrolledX, setScrolledX] = useState(false)

  // Chuỗi khóa thay cho mảng: mảng đổi identity mỗi lần render sẽ chạy lại effect.
  const keySignature = pinnedKeys.join('|')
  const rightKeySignature = pinnedRightKeys.join('|')

  const measure = useCallback(() => {
    const row = headerRowRef.current
    if (!row) return

    const next: Record<string, number> = {}
    let left = 0
    for (const key of keySignature ? keySignature.split('|') : []) {
      const cell = row.querySelector<HTMLElement>(`th[data-column-key="${CSS.escape(key)}"]`)
      if (!cell) continue
      next[key] = left
      left += cell.offsetWidth
    }

    // So sánh trước khi set: ResizeObserver bắn liên tục, set state y hệt sẽ
    // tạo vòng lặp render vô ích (và Chrome cảnh báo "ResizeObserver loop").
    setOffsets((current) => (isSameOffsets(current, next) ? current : next))

    const nextRight: Record<string, number> = {}
    let right = 0
    const rightKeys = rightKeySignature ? rightKeySignature.split('|') : []
    for (const key of rightKeys.reverse()) {
      const cell = row.querySelector<HTMLElement>(`th[data-column-key="${CSS.escape(key)}"]`)
      if (!cell) continue
      nextRight[key] = right
      right += cell.offsetWidth
    }
    setRightOffsets((current) => (isSameOffsets(current, nextRight) ? current : nextRight))
  }, [keySignature, rightKeySignature])

  useEffect(() => {
    const row = headerRowRef.current
    if (!row) return

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const cell of row.querySelectorAll('th')) observer.observe(cell)
    return () => observer.disconnect()
  }, [measure])

  /**
   * Bảng đã trượt ngang hay chưa. Mép cột ghim chỉ đổ bóng khi THẬT SỰ có nội
   * dung chạy bên dưới — lúc chưa cuộn, cột ghim nằm đúng chỗ của nó nên vạch
   * phải mảnh y hệt các cột khác, không thì trông như kẻ viền hai lần.
   */
  useEffect(() => {
    const container = headerRowRef.current?.closest<HTMLElement>('[data-slot="table-container"]')
    if (!container) return

    const sync = () => setScrolledX(container.scrollLeft > 0)
    sync()
    container.addEventListener('scroll', sync, { passive: true })
    return () => container.removeEventListener('scroll', sync)
  }, [keySignature, rightKeySignature])

  return {
    headerRowRef,
    pinnedOffsets: offsets,
    pinnedRightOffsets: rightOffsets,
    scrolledX,
  }
}

function isSameOffsets(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}
