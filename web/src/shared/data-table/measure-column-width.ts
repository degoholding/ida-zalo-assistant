/** Khoảng thở thêm sau khi đo, để chữ không dính sát mép ô. */
const SLACK = 8

/** Ô có ô nhập / ô chọn thì cần thêm chỗ cho viền và mũi tên. */
const CONTROL_EXTRA = 32

/** Trần mặc định — không để một cột dài chiếm cả màn hình. */
const DEFAULT_MAX = 640

/**
 * Bề rộng vừa đủ cho NỘI DUNG của một cột — dùng khi nháy đúp vào vạch kéo giãn
 * hoặc bấm "vừa nội dung tất cả cột".
 *
 * Cách đo: nhân bản nội dung từng ô sang một khung ĐO ẨN có `width: max-content`
 * rồi lấy bề rộng tự nhiên lớn nhất.
 *
 * Không đọc `scrollWidth` của ô thật: bảng chạy `table-fixed` và nội dung được
 * bọc `truncate`, nên `scrollWidth` luôn bằng đúng bề rộng hiện tại — đo kiểu đó
 * thì cột không bao giờ hẹp lại được.
 *
 * Cũng không đo bằng canvas theo chữ: ô có huy hiệu / nút / ảnh đại diện nằm
 * CẠNH chữ thì phần đó không được tính, cột co lại xong là chữ bị cắt cụt.
 */
export function measureColumnContentWidth(
  table: HTMLTableElement,
  columnIndex: number,
  bounds: { min: number; max?: number },
): number {
  const probe = document.createElement('div')
  // `visibility: hidden` (không phải `display: none`): vẫn phải được dàn trang
  // thì mới có bề rộng để đo.
  probe.style.cssText =
    'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;width:max-content'
  document.body.appendChild(probe)

  const clones: HTMLElement[] = []
  let padding = 24
  let hasControl = false

  try {
    for (const row of Array.from(table.rows)) {
      const cell = row.cells[columnIndex]
      if (!cell) continue

      const style = getComputedStyle(cell)
      padding = Math.max(
        padding,
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      )
      if (cell.querySelector('input, select, textarea, [role="combobox"]')) hasControl = true

      const clone = document.createElement('div')
      clone.style.cssText = 'width:max-content;max-width:none'
      // Chữ phải cùng phông với ô gốc thì con số đo mới đúng.
      clone.style.font = style.font
      clone.innerHTML = cell.innerHTML
      probe.appendChild(clone)
      clones.push(clone)
    }

    // Đọc bề rộng sau khi đã chèn hết — gom về một lần dàn trang.
    let widest = 0
    for (const clone of clones) {
      widest = Math.max(widest, clone.getBoundingClientRect().width)
    }

    const width = Math.ceil(widest + padding + SLACK + (hasControl ? CONTROL_EXTRA : 0))
    return Math.min(Math.max(width, bounds.min), bounds.max ?? DEFAULT_MAX)
  } finally {
    probe.remove()
  }
}
