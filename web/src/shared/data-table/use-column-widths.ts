import { useState } from 'react'

/** Khai báo bề rộng mặc định + chặn dưới của từng cột. */
export interface ColumnSize {
  width: number
  min: number
}

/**
 * Bề rộng cột của các bảng NHẬP LIỆU (bảng dòng hàng trong chứng từ) — khác
 * `DataTable` ở chỗ cột là cố định theo code, chỉ cần nhớ bề rộng.
 *
 * Nhớ vào `localStorage` theo `storageKey`: mỗi người kéo một kiểu, mở lại phiếu
 * khác cùng loại vẫn giữ nguyên bố cục vừa chỉnh.
 */
export function useColumnWidths<Key extends string>(
  storageKey: string,
  sizes: Record<Key, ColumnSize>,
) {
  const [widths, setWidths] = useState<Record<Key, number>>(() => readWidths(storageKey, sizes))

  function resize(key: Key, width: number) {
    setWidths((current) => {
      const next = { ...current, [key]: Math.round(width) }
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // Trình duyệt chặn storage thì bảng vẫn đổi cỡ trong phiên hiện tại.
      }
      return next
    })
  }

  /** Tổng bề rộng — dùng cho `table-fixed` để bảng không tự co cột. */
  const totalWidth = Object.values<number>(widths).reduce((sum, width) => sum + width, 0)

  return { widths, resize, totalWidth }
}

function readWidths<Key extends string>(
  storageKey: string,
  sizes: Record<Key, ColumnSize>,
): Record<Key, number> {
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, unknown>
  } catch {
    saved = {}
  }

  return Object.fromEntries(
    (Object.entries(sizes) as [Key, ColumnSize][]).map(([key, size]) => {
      const value = saved[key]
      return [
        key,
        // Bỏ qua giá trị hỏng hoặc nhỏ hơn chặn dưới: cột 0px coi như mất cột.
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(size.min, value)
          : size.width,
      ]
    }),
  ) as Record<Key, number>
}
