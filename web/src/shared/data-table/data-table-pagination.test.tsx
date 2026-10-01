import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DataTablePagination } from './data-table-pagination'

function build(over: { page?: number; pageSize?: number; total: number }) {
  return render(
    <DataTablePagination
      page={over.page ?? 1}
      pageSize={over.pageSize ?? 20}
      total={over.total}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
      unitLabel="người"
    />,
  )
}

/** Dãy nút số trang — nhận ra bằng nút «Trang sau», thứ luôn có mặt cùng nó. */
const nutTrang = () => screen.queryByRole('button', { name: /trang sau/i })
/** Ô chọn số dòng mỗi trang. */
const oSoDong = () => screen.queryByRole('combobox')

describe('DataTablePagination', () => {
  it('danh sách dài hơn một trang thì VẪN phân trang đầy đủ', () => {
    //  200 người / 20 dòng = 10 trang. Đây là ca thường ngày, và cũng là câu
    //  hỏi đầu tiên người ta đặt ra khi thấy chân bảng biết tự ẩn.
    build({ total: 200 })

    expect(nutTrang()).toBeInTheDocument()
    expect(oSoDong()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trang 1' })).toBeInTheDocument()
  })

  it('bảng rỗng thì chân bảng im hẳn — câu «bảng trống» phía trên đã nói đủ', () => {
    const { container } = build({ total: 0 })
    expect(container).toBeEmptyDOMElement()
  })

  it('vừa đúng một trang thì bỏ dãy nút số trang, giữ lại con số tổng', () => {
    //  Hai nút lùi/tiến đều xám và nút «1» bấm vào đứng nguyên chỗ cũ.
    build({ total: 1 })

    expect(nutTrang()).not.toBeInTheDocument()
    expect(screen.getByText(/Tổng/)).toHaveTextContent('Tổng 1 người')
  })

  it('danh sách bé hơn cỡ trang nhỏ nhất thì bỏ luôn ô chọn số dòng', () => {
    //  Cỡ trang nhỏ nhất là 10, nên với 1 người thì mọi lựa chọn (10·20·50·100)
    //  đều cho ra cùng một màn hình — ô chọn không điều khiển được gì.
    build({ total: 1 })
    expect(oSoDong()).not.toBeInTheDocument()
  })

  it('⚠️ GIỮ ô chọn số dòng khi vẫn còn lựa chọn chia được thành hai trang', () => {
    //  11 người / 20 dòng = một trang, nhưng chọn 10 dòng là ra hai trang — nên
    //  ô chọn vẫn còn nghĩa lý. Gộp điều kiện này vào điều kiện của dãy nút
    //  trang là sai.
    build({ total: 11 })

    expect(oSoDong()).toBeInTheDocument()
    expect(nutTrang()).not.toBeInTheDocument()
  })

  it('⚠️ chọn 100 dòng/trang trên danh sách 80 dòng thì vẫn quay về được', () => {
    //  Cái bẫy «nút hoàn tác biến mất vì chính lựa chọn cần hoàn tác»: 80 dòng
    //  ở cỡ trang 100 chỉ còn một trang, ẩn ô chọn đi là người dùng kẹt vĩnh
    //  viễn với một trang cuộn dài 80 thẻ, không đường nào về 20 dòng/trang.
    build({ total: 80, pageSize: 100 })

    expect(oSoDong()).toBeInTheDocument()
    expect(nutTrang()).not.toBeInTheDocument()
  })

  it('đúng bằng cỡ trang nhỏ nhất vẫn là ca không chia được', () => {
    //  10 người: chọn 10 dòng ra đúng một trang, không phải hai.
    build({ total: 10 })
    expect(oSoDong()).not.toBeInTheDocument()
  })
})
