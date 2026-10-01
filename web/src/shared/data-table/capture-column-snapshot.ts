/**
 * Bản sao cao bằng cả bảng, nhưng vẫn chặn trên ngần này dòng: bảng dòng chứng
 * từ có thể vài trăm dòng, `cloneNode` hết là khựng ngay khung hình đầu. Phần
 * vượt quá cũng không ai thấy — lớp phủ đã `overflow-hidden` theo chiều cao bảng.
 */
const MAX_ROWS = 200

/**
 * Chụp CỘT đang kéo thành một bảng con rời để lớp phủ bê theo con trỏ.
 *
 * Đây là cách `DragOverlay` của dnd-kit làm: thứ bay theo tay là BẢN SAO THẬT
 * của phần tử (đúng chữ, đúng canh lề, đúng màu đã tô), không phải một dải màu
 * tượng trưng — nhìn là biết ngay đang bê cột nào.
 *
 * Sao chép bằng `cloneNode` chứ không dựng lại bằng React: cột có thể chứa nút,
 * huy hiệu, ô nhập… của tầng gọi, dựng lại là phải biết hết những thứ đó.
 */
export function captureColumnSnapshot(
  headerRow: Element,
  columnKey: string,
): HTMLTableElement | null {
  const table = headerRow.closest('table')
  const headerCells = [...headerRow.querySelectorAll<HTMLElement>('th[data-column-key]')]
  const sourceHead = headerCells.find((cell) => cell.dataset.columnKey === columnKey)
  if (!table || !sourceHead) return null

  const index = [...headerRow.children].indexOf(sourceHead)
  if (index < 0) return null

  const clone = document.createElement('table')
  clone.className = table.className

  const head = document.createElement('thead')
  head.append(cloneRow(headerRow, sourceHead))

  const body = document.createElement('tbody')
  for (const row of [...(table.tBodies[0]?.rows ?? [])].slice(0, MAX_ROWS)) {
    const cell = row.cells[index]
    if (cell) body.append(cloneRow(row, cell))
  }

  clone.append(head, body)
  return clone
}

/**
 * Một hàng của bản sao: đúng một ô, và GIỮ NGUYÊN CHIỀU CAO của hàng gốc.
 *
 * Không ghim chiều cao thì hàng trong bản sao co lại theo mỗi ô chữ đó (hàng
 * gốc cao hơn vì còn ảnh đại diện, huy hiệu, ô hai dòng…), bê được vài hàng là
 * bản sao lệch hẳn khỏi bảng — mắt hết so được cột sắp nằm vào đâu.
 */
function cloneRow(source: HTMLTableRowElement | Element, cell: HTMLElement): HTMLTableRowElement {
  const row = document.createElement('tr')
  row.className = source.className
  row.style.height = `${source.getBoundingClientRect().height}px`
  row.append(detachCell(cell))
  return row
}

/**
 * Bản sao của một ô, đã gỡ những thứ chỉ có nghĩa khi ô còn nằm trong bảng gốc:
 * dính mép (`sticky` + `left/right`), bề rộng cố định (trong bảng con nó là cột
 * DUY NHẤT nên cứ rộng hết khung) và tay nắm kéo giãn (không kéo giãn được cái
 * bóng, để lại chỉ thành một vạch dọc thừa ở mép phải).
 */
function detachCell(cell: HTMLElement): HTMLElement {
  const copy = cell.cloneNode(true) as HTMLElement
  copy.classList.remove('sticky', 'z-10', 'z-20', 'z-30')
  for (const property of ['position', 'left', 'right', 'width']) {
    copy.style.removeProperty(property)
  }
  copy.removeAttribute('data-column-key')
  copy.querySelector('[role="separator"]')?.remove()
  return copy
}
