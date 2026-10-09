import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { MessageSnippetCell } from './message-snippet-cell'
import type { MessageSearchRecord } from '../types/message-search'

const MESSAGE: MessageSearchRecord = {
  id: 77, thread_id: 5, thread_name: 'K52', thread_type: 1, sender_uid: 'u1', sender_name: 'Lan',
  sent_at: '2026-10-05T03:00:00Z', kind: 1, snippet: '…Khách Minh Phát còn nợ 420 triệu…',
}

describe('MessageSnippetCell', () => {
  it('marks the searched words from the URL query and links to the exact message in its conversation', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/search?q=minh%20phat']}>
        <MessageSnippetCell message={MESSAGE} />
      </MemoryRouter>,
    )
    expect([...container.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Minh', 'Phát'])
    expect(screen.getByRole('link', { name: /Xem trong hội thoại/ })).toHaveAttribute('href', '/conversations/5?msg=77')
  })

  it('shows the snippet without marks when there is no query in the URL', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/search']}>
        <MessageSnippetCell message={MESSAGE} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('mark')).toHaveLength(0)
    expect(screen.getByText('…Khách Minh Phát còn nợ 420 triệu…')).toBeInTheDocument()
  })
})
