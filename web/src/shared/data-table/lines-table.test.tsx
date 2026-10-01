import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LinesTable } from './lines-table'
import type { LinesTableColumn } from './types'

/**
 * bao-CR-473 — màu KHAI SẴN của cột (`defaultColor`).
 *
 * Ba cột tiền của thẻ Chi phí thu mua mang màu theo độ quan trọng (xanh · vàng · đỏ).
 * Màu đó phải hiện ngay lần đầu mở bảng, nhưng không được giành quyền của người dùng:
 * ai đã tự tô cột trong menu «Cột» thì màu của họ thắng.
 */
const STORAGE_KEY = 'test-default-color'

const COLUMNS: LinesTableColumn[] = [
  { key: 'plain', header: 'Thường' },
  { key: 'estimate', header: 'Dự toán', defaultColor: 'blue' },
  { key: 'final', header: 'Quyết toán', defaultColor: 'red' },
]

function renderTable() {
  render(
    <LinesTable
      columns={COLUMNS}
      rows={[{ id: 1 }]}
      storageKey={STORAGE_KEY}
      rowKey={(row) => row.id}
      renderCell={(key) => <span>{key}-cell</span>}
      title="Bảng thử"
      emptyMessage="Trống"
    />,
  )
}

/** Ô tiêu đề (`th`) chứa chữ tiêu đề — màu cột được gắn ở đó. */
function headerCellOf(label: string): HTMLElement {
  const cell = screen.getByText(label).closest('th')
  if (!cell) throw new Error(`không thấy ô tiêu đề «${label}»`)
  return cell
}

// jsdom chuẩn hóa mã hex trong CSS thành `rgb(r, g, b)` nên so theo dạng đó.
const BLUE = 'rgb(37, 99, 235)' // #2563eb
const RED = 'rgb(220, 38, 38)' // #dc2626
const GREEN = 'rgb(22, 163, 74)' // #16a34a

afterEach(() => {
  localStorage.clear()
})

describe('LinesTable defaultColor', () => {
  it('tints a column with its declared default color on first open', () => {
    renderTable()
    expect(headerCellOf('Dự toán').style.backgroundImage).toContain(BLUE)
    expect(headerCellOf('Quyết toán').style.backgroundImage).toContain(RED)
  })

  it('leaves columns without a default color untinted', () => {
    renderTable()
    expect(headerCellOf('Thường').style.backgroundImage).toBe('')
  })

  it('lets the color the user picked win over the default', () => {
    localStorage.setItem(
      `erp.table.${STORAGE_KEY}`,
      JSON.stringify({ hiddenColumns: [], columnWidths: {}, columnOrder: [], columnColors: { final: 'green' } }),
    )
    renderTable()
    expect(headerCellOf('Quyết toán').style.backgroundImage).toContain(GREEN)
    expect(headerCellOf('Quyết toán').style.backgroundImage).not.toContain(RED)
  })

  it('tints body cells too, not only the header', () => {
    renderTable()
    const bodyCell = screen.getByText('estimate-cell').closest('td')
    expect(bodyCell?.style.backgroundImage).toContain(BLUE)
  })
})
