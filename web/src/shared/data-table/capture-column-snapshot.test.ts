import { afterEach, describe, expect, it } from 'vitest'

import { captureColumnSnapshot } from './capture-column-snapshot'

/** Dựng một bảng thật trong DOM: hàm này đọc DOM nên không mock được. */
function mountTable(rowCount: number, keys = ['code', 'name', 'qty']) {
  const table = document.createElement('table')
  table.className = 'table-fixed w-full'

  const headRow = table.createTHead().insertRow()
  for (const key of keys) {
    const cell = document.createElement('th')
    cell.dataset.columnKey = key
    cell.textContent = key.toUpperCase()
    headRow.append(cell)
  }

  const body = table.createTBody()
  for (let index = 0; index < rowCount; index += 1) {
    const row = body.insertRow()
    for (const key of keys) row.insertCell().textContent = `${key}-${index}`
  }

  document.body.append(table)
  return { table, headRow }
}

afterEach(() => document.body.replaceChildren())

describe('captureColumnSnapshot', () => {
  it('chỉ lấy đúng cột được kéo, không kéo theo cột bên cạnh', () => {
    const { headRow } = mountTable(3)
    const snapshot = captureColumnSnapshot(headRow, 'name')

    expect(snapshot?.tHead?.rows[0].cells).toHaveLength(1)
    expect(snapshot?.tHead?.rows[0].cells[0].textContent).toBe('NAME')
    expect([...(snapshot?.tBodies[0].rows ?? [])].map((row) => row.cells[0].textContent)).toEqual([
      'name-0',
      'name-1',
      'name-2',
    ])
  })

  it('bảng dài thì chặn ở 200 dòng', () => {
    // Bản sao cao bằng cả bảng, nhưng kéo cột của bảng 500 dòng mà `cloneNode`
    // cả 500 là khựng ngay khung hình đầu — phần vượt cũng bị lớp phủ cắt.
    const { headRow } = mountTable(500)
    expect(captureColumnSnapshot(headRow, 'qty')?.tBodies[0].rows).toHaveLength(200)
  })

  it('bảng ngắn hơn ngưỡng thì bê đủ mọi dòng', () => {
    const { headRow } = mountTable(23)
    expect(captureColumnSnapshot(headRow, 'qty')?.tBodies[0].rows).toHaveLength(23)
  })

  it('bảng rỗng vẫn chụp được, chỉ có mỗi ô tiêu đề', () => {
    const { headRow } = mountTable(0)
    const snapshot = captureColumnSnapshot(headRow, 'code')
    expect(snapshot?.tHead?.rows[0].cells[0].textContent).toBe('CODE')
    expect(snapshot?.tBodies[0].rows).toHaveLength(0)
  })

  it('trả null khi cột không còn trong hàng tiêu đề', () => {
    // Cột vừa bị ẩn đi giữa lúc kéo: thà không vẽ còn hơn vẽ nhầm cột khác.
    const { headRow } = mountTable(2)
    expect(captureColumnSnapshot(headRow, 'khong-co')).toBeNull()
  })

  it('gỡ dính mép và bề rộng cứng khỏi bản sao', () => {
    // Ô của cột ghim có `position: sticky` + `left`; giữ nguyên trong bảng con
    // (chỉ một cột) là ô dán vào mép trái, lệch hẳn khỏi khung bản sao.
    const { headRow, table } = mountTable(1)
    const head = headRow.cells[0]
    head.classList.add('sticky', 'z-20')
    head.style.left = '0px'
    head.style.width = '120px'
    table.tBodies[0].rows[0].cells[0].style.left = '0px'

    const snapshot = captureColumnSnapshot(headRow, 'code')
    const cloned = snapshot?.tHead?.rows[0].cells[0]
    expect(cloned?.classList.contains('sticky')).toBe(false)
    expect(cloned?.style.left).toBe('')
    expect(cloned?.style.width).toBe('')
    expect(snapshot?.tBodies[0].rows[0].cells[0].style.left).toBe('')
  })

  it('bỏ tay nắm kéo giãn khỏi bản sao', () => {
    // Tay nắm là vạch dọc ở mép phải ô tiêu đề — bê theo chỉ thành một vạch thừa.
    const { headRow } = mountTable(1)
    const handle = document.createElement('div')
    handle.setAttribute('role', 'separator')
    headRow.cells[2].append(handle)

    const snapshot = captureColumnSnapshot(headRow, 'qty')
    expect(snapshot?.querySelector('[role="separator"]')).toBeNull()
  })

  it('không đụng vào bảng gốc', () => {
    // `cloneNode` chứ không phải bê node thật đi: bảng dưới tay người dùng phải
    // còn nguyên trong lúc kéo.
    const { headRow, table } = mountTable(2)
    captureColumnSnapshot(headRow, 'name')
    expect(headRow.cells).toHaveLength(3)
    expect(table.tBodies[0].rows[0].cells).toHaveLength(3)
  })
})
