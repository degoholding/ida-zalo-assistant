/** Dấu "…" xen giữa các nhóm số trang. */
export const PAGE_ELLIPSIS = 'ellipsis'

export type PageItem = number | typeof PAGE_ELLIPSIS

/**
 * Dãy nút số trang: luôn có trang đầu, trang cuối, trang hiện tại và `siblings`
 * trang hai bên; phần bị cắt thay bằng "…".
 *
 *   getPageItems(1, 7)   -> [1, 2, 3, 4, 5, 6, 7]
 *   getPageItems(1, 9)   -> [1, 2, 3, 4, 5, '…', 9]
 *   getPageItems(5, 9)   -> [1, '…', 4, 5, 6, '…', 9]
 *   getPageItems(9, 9)   -> [1, '…', 5, 6, 7, 8, 9]
 *
 * SỐ Ô LUÔN CỐ ĐỊNH (7 ô với `siblings = 1`): đứng ở trang nào thì thanh phân
 * trang cũng rộng bằng nhau, không co giãn nhảy nhót giữa các màn hình. Đây
 * cũng là lý do khi ở đầu/cuối danh sách thì phần dư được bù thêm số trang thay
 * vì bỏ trống.
 */
export function getPageItems(
  page: number,
  pageCount: number,
  siblings = 1,
): PageItem[] {
  // đầu + cuối + hiện tại + 2 nhóm sibling + 2 dấu "…"
  const maxSlots = siblings * 2 + 5
  if (pageCount <= maxSlots) return range(1, pageCount)

  // Còn đủ chỗ ở đầu / cuối để khỏi phải cắt bên đó.
  const showLeftGap = page > siblings + 3
  const showRightGap = page < pageCount - (siblings + 2)

  // Cụm số liền nhau khi chỉ cắt một bên: bù cho đủ số ô.
  const edgeCount = maxSlots - 2

  if (!showLeftGap && showRightGap) {
    return [...range(1, edgeCount), PAGE_ELLIPSIS, pageCount]
  }

  if (showLeftGap && !showRightGap) {
    return [1, PAGE_ELLIPSIS, ...range(pageCount - edgeCount + 1, pageCount)]
  }

  return [
    1,
    PAGE_ELLIPSIS,
    ...range(page - siblings, page + siblings),
    PAGE_ELLIPSIS,
    pageCount,
  ]
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
}
