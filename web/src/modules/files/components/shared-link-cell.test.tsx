import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SHARED_LINK_KIND, type SharedLinkRecord } from '../types/shared-link'
import { SharedLinkCell } from './shared-link-cell'

function makeLink(overrides: Partial<SharedLinkRecord> = {}): SharedLinkRecord {
  return {
    id: 1, url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit', host: 'docs.google.com', kind: SHARED_LINK_KIND.googleSheets,
    google_file_id: '1AbCdEfGhIjK', title: null, message_id: 9, sender_uid: 'u1', sender_name: 'Lan', sender_avatar_url: null,
    sender_contact_id: null, sent_at: '2026-10-28T03:00:00Z', thread_id: 3, thread_type: 1, thread_name: 'Kinh doanh', ...overrides,
  }
}

describe('SharedLinkCell', () => {
  it('opens the link in a new tab without leaking the opener', () => {
    render(<SharedLinkCell link={makeLink()} />)
    const anchor = screen.getByRole('link')
    expect(anchor).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit')
    expect(anchor).toHaveAttribute('target', '_blank')
    expect(anchor.getAttribute('rel')).toContain('noopener')
  })
  it('shows the Zalo card title above the url when there is one', () => {
    render(<SharedLinkCell link={makeLink({ title: 'Bảng giá tháng 10' })} />)
    expect(screen.getByText('Bảng giá tháng 10')).toBeInTheDocument()
    expect(screen.getByText('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit')).toBeInTheDocument()
  })
  it('renders anything that is not http(s) as plain text, not a link', () => {
    render(<SharedLinkCell link={makeLink({ url: 'javascript:alert(1)' })} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
  })
})
