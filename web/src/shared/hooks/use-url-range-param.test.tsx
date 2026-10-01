import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { useUrlParamState } from './use-url-param-state'
import { useUrlRangeParam } from './use-url-range-param'

function Probe() {
  const [from, to, setRange] = useUrlRangeParam('date_from', 'date_to')
  const [searchParams] = useSearchParams()

  return (
    <>
      <span data-testid="url">{searchParams.toString()}</span>
      <span data-testid="from">{from}</span>
      <span data-testid="to">{to}</span>
      <button type="button" onClick={() => setRange('2026-08-01', '2026-08-31')}>
        Áp dụng
      </button>
      <button type="button" onClick={() => setRange('', '')}>
        Xóa
      </button>
    </>
  )
}

/** Cách làm SAI ngày trước: hai lệnh ghi param liên tiếp trong cùng một hàm xử lý. */
function TwoCallProbe() {
  const [, setFrom] = useUrlParamState('date_from', '')
  const [, setTo] = useUrlParamState('date_to', '')
  const [searchParams] = useSearchParams()

  return (
    <>
      <span data-testid="url">{searchParams.toString()}</span>
      <button
        type="button"
        onClick={() => {
          setFrom('2026-08-01')
          setTo('2026-08-31')
        }}
      >
        Áp dụng
      </button>
    </>
  )
}

function build(node: React.ReactNode, url = '/') {
  return render(<MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>)
}

describe('useUrlRangeParam', () => {
  it('nạp sẵn khoảng có trên URL', () => {
    build(<Probe />, '/?date_from=2026-01-01&date_to=2026-01-31')

    expect(screen.getByTestId('from')).toHaveTextContent('2026-01-01')
    expect(screen.getByTestId('to')).toHaveTextContent('2026-01-31')
  })

  it('ghi ĐỦ CẢ HAI đầu trong một lần bấm', async () => {
    //  LỖI PHẢI TRÁNH: `setSearchParams` dựng bản mới từ `searchParams` của lần
    //  vẽ hiện tại. Gọi hai lệnh liên tiếp thì lệnh sau đọc đúng bản cũ và ghi
    //  đè lệnh trước — mất luôn đầu "từ ngày". Xem `TwoCallProbe` bên dưới.
    const nguoi = userEvent.setup()
    build(<Probe />)

    await nguoi.click(screen.getByRole('button', { name: 'Áp dụng' }))

    expect(screen.getByTestId('url')).toHaveTextContent('date_from=2026-08-01')
    expect(screen.getByTestId('url')).toHaveTextContent('date_to=2026-08-31')
  })

  it('cách cũ (hai lệnh liên tiếp) đúng là làm rơi mất một đầu', async () => {
    //  Test này canh chính lý do `useUrlRangeParam` tồn tại. Ngày nào react-router
    //  gộp được hai lệnh thì nó đỏ lên — lúc đó mới được phép bỏ hook này đi.
    const nguoi = userEvent.setup()
    build(<TwoCallProbe />)

    await nguoi.click(screen.getByRole('button', { name: 'Áp dụng' }))

    expect(screen.getByTestId('url')).not.toHaveTextContent('date_from')
    expect(screen.getByTestId('url')).toHaveTextContent('date_to=2026-08-31')
  })

  it('xóa khoảng thì dọn sạch cả hai param, giữ nguyên param của bộ lọc khác', async () => {
    const nguoi = userEvent.setup()
    build(<Probe />, '/?status=unpaid&date_from=2026-01-01&date_to=2026-01-31')

    await nguoi.click(screen.getByRole('button', { name: 'Xóa' }))

    expect(screen.getByTestId('url')).toHaveTextContent('status=unpaid')
    expect(screen.getByTestId('url')).not.toHaveTextContent('date_from')
    expect(screen.getByTestId('url')).not.toHaveTextContent('date_to')
  })

  it('chỉ có một đầu thì vẫn ghi đầu đó, không ép phải đủ cặp', () => {
    //  "Từ 01/08 tới nay" là câu hỏi có thật của kế toán — backend nhận thiếu
    //  một đầu bình thường.
    build(<Probe />, '/?date_from=2026-08-01')

    expect(screen.getByTestId('from')).toHaveTextContent('2026-08-01')
    expect(screen.getByTestId('to')).toBeEmptyDOMElement()
  })
})
