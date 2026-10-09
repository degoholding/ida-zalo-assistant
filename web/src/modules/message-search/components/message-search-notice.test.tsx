import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MessageSearchNotice } from './message-search-notice'

const base = { total: 3, items: [] }

describe('MessageSearchNotice', () => {
  // Review 09/10/2026: máy chủ lùi về dò 90 ngày mà màn không nói gì — người tìm tưởng tin cũ
  // không tồn tại
  it('tells the searcher the date the search was limited to', () => {
    render(<MessageSearchNotice result={{ ...base, window_from: '2026-07-10T17:00:00.000Z' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('chỉ tìm các tin từ 11/07/2026 trở đi')
  })

  // Bảng tìm mới: tin cũ được nạp dần trong nền — chưa nạp xong mà im lặng thì người tìm tưởng tin cũ không tồn tại
  it('warns that older messages are still being loaded into search', () => {
    render(<MessageSearchNotice result={{ ...base, indexed_from: '2026-08-31T17:00:00.000Z' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('mới tìm được các tin từ khoảng 01/09/2026 trở đi')
  })

  it('says there are more matches than shown when the server stopped counting', () => {
    render(<MessageSearchNotice result={{ ...base, total: 1000, total_capped: true }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Có hơn 1.000 tin khớp')
  })

  it('combines both limits in one line', () => {
    render(<MessageSearchNotice result={{ ...base, total: 1000, total_capped: true, window_from: '2026-07-10T17:00:00.000Z' }} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('11/07/2026')
    expect(status).toHaveTextContent('Có hơn 1.000 tin khớp')
  })

  it('renders nothing when the search was complete, not loaded yet, or the server sent no extras', () => {
    const { container, rerender } = render(
      <MessageSearchNotice result={{ ...base, window_from: null, indexed_from: null, total_capped: false }} />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<MessageSearchNotice result={undefined} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<MessageSearchNotice result={base} />)
    expect(container).toBeEmptyDOMElement()
  })
})
