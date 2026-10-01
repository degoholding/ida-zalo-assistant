import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Button } from '@/shared/ui/button'
import { DetailPageHeader, ResponsiveLabel } from './detail-page-header'

function renderHeader() {
  return render(
    <MemoryRouter>
      <DetailPageHeader
        backTo="/procurement/purchase-requests"
        backLabel="Về danh sách yêu cầu mua hàng"
        title="PYC260914001"
        badges={<span>Đã điều phối</span>}
        primaryActions={<Button>Tạo đơn mua hàng</Button>}
        secondaryActions={<Button variant="outline">Nhân bản</Button>}
      />
    </MemoryRouter>,
  )
}

describe('DetailPageHeader', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('khổ rộng bày THẲNG lệnh phụ — không ai phải bấm thêm một nhịp', () => {
    renderHeader()

    expect(screen.getByRole('button', { name: 'Nhân bản' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lệnh khác' })).toBeNull()
  })

  it('khổ hẹp gom lệnh phụ vào ⋯, nhưng lệnh CHÍNH vẫn ở ngoài', () => {
    //  Luật chia đúng bằng dáng nút: nút nền đặc là việc người mở trang đang
    //  định làm — giấu nó sau `⋯` là bắt thêm một chạm cho thao tác thường
    //  xuyên nhất. Xem `HeaderActionsPopover`.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    renderHeader()

    expect(screen.getByRole('button', { name: 'Tạo đơn mua hàng' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lệnh khác' })).toBeInTheDocument()
    // Popover đóng => lệnh phụ chưa dựng ra DOM.
    expect(screen.queryByRole('button', { name: 'Nhân bản' })).toBeNull()
  })

  it('KHÔNG dựng nút ⋯ khi trang không có lệnh phụ nào', () => {
    //  Phiếu ở trạng thái khóa chỉ còn vài lệnh chính. Nút `⋯` mở ra một tấm
    //  rỗng là mời người dùng bấm vào chỗ không có gì.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    render(
      <MemoryRouter>
        <DetailPageHeader backTo="/x" backLabel="Về" title="PYC260914001" />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Lệnh khác' })).toBeNull()
  })

  it('mã phiếu và huy hiệu luôn đọc đủ — không cắt bằng "…"', () => {
    renderHeader()

    expect(screen.getByRole('heading', { name: 'PYC260914001' })).toBeInTheDocument()
    expect(screen.getByText('Đã điều phối')).toBeInTheDocument()
  })

  it('nút về danh sách là LIÊN KẾT có nhãn đọc màn hình', () => {
    //  Nút chỉ có mũi tên; thiếu `aria-label` thì trình đọc màn hình đọc ra một
    //  liên kết rỗng.
    renderHeader()

    const back = screen.getByRole('link', { name: 'Về danh sách yêu cầu mua hàng' })
    expect(back).toHaveAttribute('href', '/procurement/purchase-requests')
  })
})

describe('ResponsiveLabel', () => {
  it('dựng CẢ HAI bản, để CSS chọn — bản ngắn cho khổ hẹp', () => {
    //  Đổi bằng CSS được vì nhãn là nút DOM (khác `placeholder` của SearchField).
    //  Cả hai phải có mặt, nếu không thì đổi khổ màn là chữ biến mất hẳn.
    render(<ResponsiveLabel short="Tạo ĐMH" long="Tạo đơn mua hàng" />)

    expect(screen.getByText('Tạo ĐMH')).toHaveClass('md:hidden')
    expect(screen.getByText('Tạo đơn mua hàng')).toHaveClass('max-md:hidden')
  })
})
