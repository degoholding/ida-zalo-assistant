import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createSelectionColumn } from './selection-column'

interface Row {
  id: number
  name: string
}

function makeColumn(overrides: Partial<Parameters<typeof createSelectionColumn<Row>>[0]> = {}) {
  return createSelectionColumn<Row>({
    getRowId: (row) => row.id,
    selectedIds: new Set(),
    onToggleRow: vi.fn(),
    onToggleAllOnPage: vi.fn(),
    allOnPageSelected: false,
    someOnPageSelected: false,
    ...overrides,
  })
}

describe('createSelectionColumn — ô tick tiêu đề (chọn/bỏ cả trang)', () => {
  it('cả trang đã chọn hết → tick, nhãn "Bỏ chọn cả trang"', () => {
    const column = makeColumn({ allOnPageSelected: true, someOnPageSelected: true })
    render(<div>{column.headerContent}</div>)
    expect(screen.getByRole('checkbox', { name: 'Bỏ chọn cả trang' })).toBeChecked()
  })

  it('chưa ai chọn → không tick, nhãn "Chọn cả trang"', () => {
    const column = makeColumn()
    render(<div>{column.headerContent}</div>)
    const checkbox = screen.getByRole('checkbox', { name: 'Chọn cả trang' })
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveAttribute('aria-checked', 'false')
  })

  it('chọn MỘT PHẦN trang → aria-checked="mixed" (indeterminate), nhãn vẫn "Chọn cả trang"', () => {
    const column = makeColumn({ someOnPageSelected: true, allOnPageSelected: false })
    render(<div>{column.headerContent}</div>)
    const checkbox = screen.getByRole('checkbox', { name: 'Chọn cả trang' })
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
  })

  it('bấm ô tick tiêu đề gọi onToggleAllOnPage', async () => {
    const user = userEvent.setup()
    const onToggleAllOnPage = vi.fn()
    const column = makeColumn({ onToggleAllOnPage })
    render(<div>{column.headerContent}</div>)
    await user.click(screen.getByRole('checkbox'))
    expect(onToggleAllOnPage).toHaveBeenCalledTimes(1)
  })
})

describe('createSelectionColumn — ô tick từng dòng', () => {
  const row: Row = { id: 7, name: 'Quy chế văn bản' }

  it('dòng đang chọn thì tick, nhãn dùng getRowLabel khi có', () => {
    const column = makeColumn({ selectedIds: new Set([7]), getRowLabel: (r) => r.name })
    render(<div>{column.cell(row)}</div>)
    expect(screen.getByRole('checkbox', { name: 'Chọn Quy chế văn bản' })).toBeChecked()
  })

  it('không có getRowLabel thì nhãn rơi về ID', () => {
    const column = makeColumn()
    render(<div>{column.cell(row)}</div>)
    expect(screen.getByRole('checkbox', { name: 'Chọn dòng 7' })).toBeInTheDocument()
  })

  it('bấm ô tick gọi onToggleRow ĐÚNG id của dòng, KHÔNG làm nổi bọt click lên dòng (mở trang chi tiết)', async () => {
    const user = userEvent.setup()
    const onToggleRow = vi.fn()
    const onRowClick = vi.fn()
    const column = makeColumn({ onToggleRow, getRowLabel: (r) => r.name })
    //  Mô phỏng `onRowClick` của `DataTable` thật — cột «Chọn» phải chặn nổi
    //  bọt lên đây, không thì tick một dòng lại mở luôn trang chi tiết.
    render(<div onClick={onRowClick}>{column.cell(row)}</div>)
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Quy chế văn bản' }))
    expect(onToggleRow).toHaveBeenCalledWith(7)
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
