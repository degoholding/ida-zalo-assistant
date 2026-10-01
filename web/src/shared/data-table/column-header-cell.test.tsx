import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Table, TableHeader, TableRow } from '@/shared/ui/table'
import { ColumnHeaderCell } from './column-header-cell'
import type { DataTableColumn } from './types'

interface Row {
  id: number
}

const COLUMN: DataTableColumn<Row> = {
  key: 'code',
  header: 'Mã phiếu',
  sortable: true,
  cell: (row) => row.id,
}

function renderHeader(column: DataTableColumn<Row> = COLUMN) {
  const onSort = vi.fn()

  render(
    <Table>
      <TableHeader>
        <TableRow>
          <ColumnHeaderCell
            column={column}
            minWidth={64}
            sortDir={null}
            onSort={onSort}
            onResize={vi.fn()}
            onDragStart={vi.fn()}
          />
        </TableRow>
      </TableHeader>
    </Table>,
  )

  return { onSort }
}

/**
 * Giả lập việc người dùng đang bôi đen chữ. `anchorNode` quyết định vệt bôi đen
 * nằm TRONG hay NGOÀI ô tiêu đề — đó chính là điều ô tiêu đề phải phân biệt.
 */
function stubSelection(options: { collapsed: boolean; anchorNode?: Node | null }) {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: options.collapsed,
    rangeCount: options.collapsed ? 0 : 1,
    anchorNode: options.anchorNode ?? null,
    focusNode: options.anchorNode ?? null,
  } as unknown as Selection)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ColumnHeaderCell', () => {
  it('sorts on a plain click when nothing is selected', async () => {
    const user = userEvent.setup()
    const { onSort } = renderHeader()
    stubSelection({ collapsed: true })

    await user.click(screen.getByText('Mã phiếu'))

    expect(onSort).toHaveBeenCalledTimes(1)
  })

  // Người dùng chép TÊN CỘT ra ngoài (khách báo 31/08/2026). Bôi đen xong nhả
  // chuột mà bảng nhảy thứ tự thì coi như không chép được — đừng gỡ test này.
  it('does NOT sort when the release ends a text selection inside the header', async () => {
    const user = userEvent.setup()
    const { onSort } = renderHeader()
    const label = screen.getByText('Mã phiếu')
    stubSelection({ collapsed: false, anchorNode: label.firstChild })

    await user.click(label)

    expect(onSort).not.toHaveBeenCalled()
  })

  it('still sorts when the selection sits somewhere else on the page', async () => {
    const user = userEvent.setup()
    const { onSort } = renderHeader()
    stubSelection({ collapsed: false, anchorNode: document.createTextNode('chữ ở màn khác') })

    await user.click(screen.getByText('Mã phiếu'))

    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('leaves a non-sortable column alone no matter what is selected', async () => {
    const user = userEvent.setup()
    const { onSort } = renderHeader({ ...COLUMN, sortable: false })
    stubSelection({ collapsed: true })

    await user.click(screen.getByText('Mã phiếu'))

    expect(onSort).not.toHaveBeenCalled()
  })

  it('renders a custom header slot in place of the label text', () => {
    renderHeader({
      ...COLUMN,
      headerContent: <input type="checkbox" aria-label="Chọn mọi khoản trong trang" />,
    })

    expect(screen.getByRole('checkbox', { name: 'Chọn mọi khoản trong trang' })).toBeInTheDocument()
    // Nhãn chữ nhường chỗ, nhưng `header` vẫn phải khai vì menu "Cột" còn dùng.
    expect(screen.queryByText('Mã phiếu')).not.toBeInTheDocument()
  })

  // Ô tick "chọn hết" nằm ngay trong ô tiêu đề CÓ sắp xếp. Không chặn nổi bọt thì
  // mỗi lần tick là bảng đảo thứ tự — dòng vừa tick trôi đi chỗ khác.
  it('does NOT sort when the click lands inside the custom header slot', async () => {
    const user = userEvent.setup()
    const { onSort } = renderHeader({
      ...COLUMN,
      headerContent: <input type="checkbox" aria-label="Chọn mọi khoản trong trang" />,
    })
    stubSelection({ collapsed: true })

    await user.click(screen.getByRole('checkbox', { name: 'Chọn mọi khoản trong trang' }))

    expect(onSort).not.toHaveBeenCalled()
  })

  it('splits the trailing " *" into a red mark instead of printing it as text', () => {
    renderHeader({ ...COLUMN, header: 'Mã phiếu *' })

    // Nhãn còn đúng chữ, dấu sao là phần tử riêng — có vậy mới chép ra sạch.
    expect(screen.getByText('Mã phiếu')).toBeInTheDocument()
    expect(screen.queryByText('Mã phiếu *')).not.toBeInTheDocument()
  })
})
