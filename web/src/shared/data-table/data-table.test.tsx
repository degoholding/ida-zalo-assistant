import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataTable } from './data-table'
import type { DataTableColumn } from './types'

interface Row {
  id: number
  name: string
  note: string
}

const ROWS: Row[] = [{ id: 1, name: 'Nguyễn Văn A', note: 'ghi chú rất dài '.repeat(20) }]

function build(columns: DataTableColumn<Row>[], storageKey?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <DataTable
        columns={columns}
        rows={ROWS}
        getRowId={(r) => r.id}
        storageKey={storageKey}
      />
    </QueryClientProvider>,
  )
  return container.querySelector('table') as HTMLTableElement
}

beforeEach(() => {
  //  Bố cục cột nhớ trong `localStorage`; sót lại giữa hai bài là bề rộng của
  //  bài trước đè lên bài sau.
  localStorage.clear()
})

/**
 * SÀN bề rộng của bảng.
 *
 * ⚠️ LỖI ĐÃ XẢY RA (04/09/2026, màn Đơn nghỉ phép trong khung 940px): không có
 * sàn thì `table-fixed` + `w-full` co MỌI cột lại theo tỷ lệ, cột khai `wrap`
 * bị bóp còn vài chục pixel và chữ trong đó rớt xuống ba mươi dòng — một hàng
 * cao 600px, còn thẻ chứa bảng thì đội cả trang trượt ngang.
 */
describe('DataTable — sàn bề rộng', () => {
  it('sàn bằng TỔNG bề rộng các cột đang hiện', () => {
    const table = build([
      { key: 'id', header: 'Mã', cell: (r) => r.id, width: 100 },
      { key: 'name', header: 'Tên', cell: (r) => r.name, width: 250 },
    ])
    expect(table.style.minWidth).toBe('350px')
  })

  it('cột KHÔNG khai bề rộng vẫn góp sàn của chính nó, không tụt về 0', () => {
    //  Đây là chỗ `min-w-max` của Tailwind bó tay: bảng `table-fixed` chỉ tính
    //  `max-content` từ cột CÓ khai bề rộng, nên cột để trống biến mất hẳn.
    const table = build([
      { key: 'id', header: 'Mã', cell: (r) => r.id, width: 100 },
      { key: 'note', header: 'Ghi chú', cell: (r) => r.note, wrap: true, minWidth: 180 },
    ])
    expect(table.style.minWidth).toBe('280px')
  })

  it('cột không khai gì cả thì lấy sàn mặc định', () => {
    const table = build([{ key: 'name', header: 'Tên', cell: (r) => r.name }])
    expect(table.style.minWidth).toBe('64px')
  })

  it('cột ĐANG ẨN không tính vào sàn — bảng phải co lại theo', () => {
    //  Ẩn bớt cột mà sàn giữ nguyên thì bảng vẫn rộng như cũ, chừa một khoảng
    //  trắng bên phải trong khung viền (đúng lỗi CR-102 của `LinesTable`).
    const table = build([
      { key: 'id', header: 'Mã', cell: (r) => r.id, width: 100 },
      { key: 'name', header: 'Tên', cell: (r) => r.name, width: 250, defaultHidden: true },
    ])
    expect(table.style.minWidth).toBe('100px')
  })

  it('lấy bề rộng NGƯỜI DÙNG ĐÃ KÉO, không lấy số khai trong code', () => {
    //  Kéo cột rộng ra rồi mà sàn vẫn tính theo số cũ thì bảng lại bị bóp đúng
    //  bằng phần vừa kéo thêm — công kéo giãn đổ sông.
    localStorage.setItem(
      'erp.table.test.leave-types',
      JSON.stringify({
        hiddenColumns: [],
        columnWidths: { id: 400 },
        columnOrder: [],
        pinnedColumns: [],
        columnColors: {},
      }),
    )
    const table = build(
      [{ key: 'id', header: 'Mã', cell: (r) => r.id, width: 100 }],
      'test.leave-types',
    )
    expect(table.style.minWidth).toBe('400px')
  })

  it('ẩn HẾT cột thì sàn về 0, không nổ', () => {
    const table = build([
      { key: 'id', header: 'Mã', cell: (r) => r.id, width: 100, defaultHidden: true },
    ])
    expect(table.style.minWidth).toBe('0px')
  })

  it('KHÔNG đặt bề rộng cứng — bảng vẫn giãn hết khung khi màn rộng', () => {
    const table = build([{ key: 'id', header: 'Mã', cell: (r) => r.id, width: 100 }])
    expect(table.style.width).toBe('')
    expect(table.className).toContain('table-fixed')
  })
})

/**
 * ─── BA TRẠNG THÁI RỖNG (D1–D3) ───
 *
 * Kiểu hỏng đắt nhất của giao diện phân quyền: **một bảng trống có ba nghĩa**
 * hoàn toàn khác nhau và người dùng không phân biệt được cái nào —
 *
 * | Thật ra là | Người dùng thấy |
 * |---|---|
 * | Không có dữ liệu | bảng rỗng |
 * | Có dữ liệu nhưng ngoài phạm vi | bảng rỗng |
 * | Không có quyền (403) | bảng rỗng |
 *
 * Đây là nguồn số 1 của câu "hệ thống lỗi rồi" mỗi lần khai quyền hẹp, và cũng
 * là lý do một lỗ phạm vi sống rất lâu: người bị lọc nhầm trông giống hệt người
 * không có dữ liệu. `DataTable` phải tách được ÍT NHẤT hai nhánh (rỗng / lỗi),
 * và trang gọi nó có trách nhiệm truyền câu chữ đúng cho nhánh còn lại.
 */
function buildState(props: Partial<Parameters<typeof DataTable<Row>>[0]>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={client}>
      <DataTable
        columns={[{ key: 'id', header: 'Mã', cell: (r) => r.id, width: 100 }]}
        rows={[]}
        getRowId={(r) => r.id}
        {...props}
      />
    </QueryClientProvider>,
  )
  return container
}

describe('DataTable — ba trạng thái rỗng', () => {
  it('không có dữ liệu và lỗi tải là HAI câu khác nhau', () => {
    const rong = buildState({}).textContent ?? ''
    const loi = buildState({ isError: true }).textContent ?? ''

    expect(rong).toContain('Không có dữ liệu.')
    expect(loi).toContain('Không tải được danh sách')
    //  Dùng chung một câu = mất luôn khả năng phân biệt, và đó chính là lỗ 09-C.
    expect(loi).not.toContain('Không có dữ liệu.')
  })

  it('đang tải KHÔNG được hiện câu "không có dữ liệu"', () => {
    //  Nháy câu đó trong lúc chờ mạng là người dùng đọc được "không có gì" rồi
    //  bỏ đi trước khi dữ liệu về.
    const container = buildState({ isLoading: true })
    expect(container.textContent).not.toContain('Không có dữ liệu.')
    expect(container.textContent).not.toContain('Không tải được danh sách')
  })

  it('lỗi thì KHÔNG vẽ dòng dữ liệu cũ lẫn vào', () => {
    const container = buildState({ isError: true, rows: ROWS })
    expect(container.textContent).not.toContain('Nguyễn Văn A')
  })

  it('trang truyền được câu riêng cho nhánh THIẾU QUYỀN', () => {
    //  Backend lọc phạm vi bằng cách trả DANH SÁCH RỖNG (không phải 403), nên
    //  chính trang mới biết nên nói gì. `DataTable` chỉ cần đừng nói dối thay nó.
    const container = buildState({
      emptyMessage: 'Không có chứng từ nào trong phạm vi dữ liệu của bạn.',
    })
    expect(container.textContent).toContain('trong phạm vi dữ liệu của bạn')
    expect(container.textContent).not.toContain('Không có dữ liệu.')
  })

  it('câu lỗi MẶC ĐỊNH có nhắc tới quyền, vì 403 trên GET không bật toast', () => {
    //  `core/api/http-client.ts` chỉ toast cho POST/PATCH/PUT/DELETE. Nghĩa là
    //  ô chữ này là NƠI DUY NHẤT người dùng biết mình vừa bị chặn.
    expect(buildState({ isError: true }).textContent).toMatch(/quyền/)
  })

  it('`rows` chưa về (undefined) khác hẳn `rows` rỗng', () => {
    //  `data?.items ?? []` ở tầng trang biến "chưa gọi xong" thành "rỗng" —
    //  bảng phải không tự bịa thêm câu nào khi chưa có mảng.
    expect(buildState({ rows: undefined }).textContent).not.toContain('Không có dữ liệu.')
  })
})

/**
 * ─── CHU KỲ SẮP XẾP KHI BẤM TIÊU ĐỀ (bao-CR-300) ───
 *
 * Ba nhịp: tăng → giảm → THÔI (khóa cột rỗng). Cột khai `sortDescFirst`
 * (cột thời gian như "Ngày cập nhật") đảo chu kỳ thành giảm → tăng → thôi:
 * bấm vào là muốn thấy bản ghi mới nhất ngay nhịp đầu.
 */
function buildSortable(opts: { sortDescFirst?: boolean; sortBy?: string; sortDir?: 'asc' | 'desc' }) {
  const onSortChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DataTable
        columns={[
          { key: 'name', header: 'Tên', cell: (r: Row) => r.name, width: 200, sortable: true },
          {
            key: 'updated_at',
            header: 'Ngày cập nhật',
            cell: () => '',
            width: 150,
            sortable: true,
            sortDescFirst: opts.sortDescFirst,
          },
        ]}
        rows={ROWS}
        getRowId={(r) => r.id}
        sortBy={opts.sortBy ?? ''}
        sortDir={opts.sortDir ?? 'asc'}
        onSortChange={onSortChange}
      />
    </QueryClientProvider>,
  )
  return { onSortChange }
}

describe('DataTable — chu kỳ sắp xếp', () => {
  it('a plain column cycles asc, then desc, then clears the sort key', async () => {
    const user = userEvent.setup()

    const first = buildSortable({})
    await user.click(screen.getByText('Tên'))
    expect(first.onSortChange).toHaveBeenCalledWith('name', 'asc')

    const second = buildSortable({ sortBy: 'name', sortDir: 'asc' })
    await user.click(screen.getAllByText('Tên')[1])
    expect(second.onSortChange).toHaveBeenCalledWith('name', 'desc')

    //  Nhịp ba trả khóa RỖNG — trang bọc `if (sortBy)` nên rỗng = về mặc định.
    const third = buildSortable({ sortBy: 'name', sortDir: 'desc' })
    await user.click(screen.getAllByText('Tên')[2])
    expect(third.onSortChange).toHaveBeenCalledWith('', 'asc')
  })

  it('a sortDescFirst column shows the newest first: desc, then asc, then clears', async () => {
    const user = userEvent.setup()

    const first = buildSortable({ sortDescFirst: true })
    await user.click(screen.getByText('Ngày cập nhật'))
    expect(first.onSortChange).toHaveBeenCalledWith('updated_at', 'desc')

    const second = buildSortable({ sortDescFirst: true, sortBy: 'updated_at', sortDir: 'desc' })
    await user.click(screen.getAllByText('Ngày cập nhật')[1])
    expect(second.onSortChange).toHaveBeenCalledWith('updated_at', 'asc')

    const third = buildSortable({ sortDescFirst: true, sortBy: 'updated_at', sortDir: 'asc' })
    await user.click(screen.getAllByText('Ngày cập nhật')[2])
    expect(third.onSortChange).toHaveBeenCalledWith('', 'asc')
  })

  it('clicking another column restarts its own cycle instead of continuing the old one', async () => {
    //  Đang xếp theo "Tên" mà bấm "Ngày cập nhật" thì phải ra desc (nhịp đầu
    //  của cột thời gian), không phải nối tiếp chu kỳ của cột cũ.
    const user = userEvent.setup()
    const { onSortChange } = buildSortable({
      sortDescFirst: true,
      sortBy: 'name',
      sortDir: 'desc',
    })

    await user.click(screen.getByText('Ngày cập nhật'))
    expect(onSortChange).toHaveBeenCalledWith('updated_at', 'desc')
  })
})

describe('DataTable — onRowDoubleClick', () => {
  function buildWithHandlers() {
    const onRowClick = vi.fn()
    const onRowDoubleClick = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <DataTable
          columns={[{ key: 'name', header: 'Tên', cell: (r: Row) => r.name }]}
          rows={ROWS}
          getRowId={(r: Row) => r.id}
          onRowClick={onRowClick}
          onRowDoubleClick={onRowDoubleClick}
        />
      </QueryClientProvider>,
    )
    return { onRowClick, onRowDoubleClick }
  }

  it('bấm đúp gọi CẢ HAI: onRowClick (cú đầu) và onRowDoubleClick — cộng thêm, không thay thế', async () => {
    const user = userEvent.setup()
    const { onRowClick, onRowDoubleClick } = buildWithHandlers()

    await user.dblClick(screen.getByText('Nguyễn Văn A'))

    expect(onRowDoubleClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalled()
  })

  it('bấm THƯỜNG một lần không gọi onRowDoubleClick', async () => {
    const user = userEvent.setup()
    const { onRowClick, onRowDoubleClick } = buildWithHandlers()

    await user.click(screen.getByText('Nguyễn Văn A'))

    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowDoubleClick).not.toHaveBeenCalled()
  })

  it('không khai onRowDoubleClick thì bấm đúp không ném lỗi (mặc định optional)', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <DataTable
          columns={[{ key: 'name', header: 'Tên', cell: (r: Row) => r.name }]}
          rows={ROWS}
          getRowId={(r: Row) => r.id}
        />
      </QueryClientProvider>,
    )
    await expect(user.dblClick(screen.getByText('Nguyễn Văn A'))).resolves.not.toThrow()
  })
})

/**
 * bao-CR-518 — màu cột khai SẴN (`defaultColor`) cho cột mang nghĩa (bốn cột giá của
 * Tra cứu thị trường). Màu người dùng tự chọn trong menu «Cột» vẫn phải thắng.
 */
describe('DataTable — defaultColor', () => {
  const tinted = (cell: Element | null) => (cell as HTMLElement | null)?.style.backgroundImage ?? ''

  it('tints header and body cells of a column that declares defaultColor, and only that column', () => {
    const table = build([
      { key: 'name', header: 'Tên', cell: (r) => r.name, defaultColor: 'green' },
      { key: 'note', header: 'Ghi chú', cell: (r) => r.note },
    ])
    const heads = table.querySelectorAll('thead th')
    const cells = table.querySelectorAll('tbody td')
    expect(tinted(heads[0])).toContain('linear-gradient')
    expect(tinted(cells[0])).toContain('linear-gradient')
    expect(tinted(heads[1])).toBe('')
    expect(tinted(cells[1])).toBe('')
  })

  it('lets the colour saved by the user override the declared default', () => {
    localStorage.setItem('erp.table.t-color', JSON.stringify({ columnColors: { name: 'red' } }))
    const table = build(
      [{ key: 'name', header: 'Tên', cell: (r) => r.name, defaultColor: 'green' }],
      't-color',
    )
    const head = tinted(table.querySelector('thead th'))
    //  #dc2626 = đỏ trong COLUMN_COLORS, #16a34a = xanh lá.
    expect(head).toContain('220, 38, 38')
    expect(head).not.toContain('22, 163, 74')
  })
})

/** bao-CR-519 — vạch ngăn nhóm cột: chỉ cột khai `dividerAfter` có vạch đậm, ở cả tiêu đề lẫn thân. */
describe('DataTable — dividerAfter', () => {
  it('draws the thick group divider only on columns that declare it', () => {
    const table = build([
      { key: 'name', header: 'Tên', cell: (r) => r.name, dividerAfter: true },
      { key: 'note', header: 'Ghi chú', cell: (r) => r.note },
    ])
    const heads = table.querySelectorAll('thead th')
    const cells = table.querySelectorAll('tbody td')
    expect(heads[0].className).toContain('inset_-2px')
    expect(cells[0].className).toContain('inset_-2px')
    expect(heads[1].className).not.toContain('inset_-2px')
    expect(cells[1].className).not.toContain('inset_-2px')
  })
})
