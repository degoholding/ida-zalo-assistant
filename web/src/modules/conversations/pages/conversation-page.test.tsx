import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, MessagesPage, ThreadDetail } from '../types/conversation'
import { ConversationPage } from './conversation-page'

const apiGet = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  httpClient: { post: vi.fn(), get: vi.fn() },
  extractErrorMessage: () => 'lỗi',
}))

// jsdom không có EventSource — kênh đẩy tin mới không cần trong bài này
class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const THREAD: ThreadDetail = {
  id: 5, thread_type: 1, name: 'Ban giám đốc', label: '', display_name: 'Ban giám đốc', zalo_group_id: 'g5', company_id: null,
  message_count: 300, last_message_at: '2026-10-08T03:00:00Z', last_text: 'mới nhất', last_sender: 'Lan', last_from_bot: false, avatar_url: null,
  bot_name: 'Bot', contact: null,
  group: { id: 5, name: 'Ban giám đốc', label: '', zalo_group_id: 'g5', group_kind: 2, member_count: 3, read_messages: 1, capture_files: 1,
    retention_days: 0, company_id: null, company_name: null, avatar_url: null, members: [] },
}

function makeMessage(id: number, text: string): ChatMessage {
  return {
    id, sender_uid: 'u1', sender_name: 'Lan', sender_contact_id: null, sender_avatar_url: null, sent_at: `2026-09-01T0${id % 10}:00:00Z`, text,
    kind: 0, zalo_msg_type: 'webchat', quote_text: null, recalled_at: null, from_bot: false, from_admin: false, attachment: null,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="url">{`${location.pathname}${location.search}`}</output>
}

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/conversations/:id" element={<><ConversationPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Máy chủ giả: trả theo đường + tham số; `pages` = trang tin theo khóa tham số. */
function serve(pages: Record<string, MessagesPage | Error>) {
  apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/api/conversations') return { items: [], total: 0, page: 1, page_size: 200 }
    if (url === '/api/conversations/5') return THREAD
    if (url === '/api/conversations/5/messages') {
      const key = JSON.stringify(config?.params ?? {})
      const page = pages[key]
      if (!page) throw new Error(`không có trang ${key}`)
      if (page instanceof Error) throw page
      return page
    }
    throw new Error(`không mong gọi ${url}`)
  })
}

beforeAll(() => vi.stubGlobal('EventSource', FakeEventSource))
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => vi.clearAllMocks())

describe('ConversationPage ?msg=', () => {
  it('loads the page around the linked message, highlights it, and pages newer / older by message id', async () => {
    serve({
      '{"around":77}': { items: [makeMessage(76, 'tin 76'), makeMessage(77, 'tin được trỏ'), makeMessage(78, 'tin 78')], older_cursor: 76, newer_cursor: 78 },
      '{"after_id":78}': { items: [makeMessage(79, 'tin 79')], older_cursor: 79, newer_cursor: null },
      '{"before_id":76}': { items: [makeMessage(75, 'tin 75')], older_cursor: null, newer_cursor: null },
    })
    renderAt('/conversations/5?msg=77')

    const target = await screen.findByText('tin được trỏ')
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/5/messages', { params: { around: 77 } })
    // Không tải trang mới nhất khi đang mở quanh một tin
    expect(apiGet).not.toHaveBeenCalledWith('/api/conversations/5/messages', { params: {} })
    await waitFor(() => expect(target.closest('[data-message-id]')).toHaveAttribute('aria-current', 'true'))

    await userEvent.click(screen.getByRole('button', { name: 'Xem tin mới hơn' }))
    expect(await screen.findByText('tin 79')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/5/messages', { params: { after_id: 78 } })
    expect(screen.queryByRole('button', { name: 'Xem tin mới hơn' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Xem tin cũ hơn' }))
    expect(await screen.findByText('tin 75')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/api/conversations/5/messages', { params: { before_id: 76 } })

    // Thứ tự hiển thị: cũ trên, mới dưới
    const order = ['tin 75', 'tin 76', 'tin được trỏ', 'tin 78', 'tin 79'].map((text) => screen.getByText(text))
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('«Về tin mới nhất» drops ?msg and loads the latest page', async () => {
    serve({
      '{"around":77}': { items: [makeMessage(77, 'tin được trỏ')], older_cursor: null, newer_cursor: 77 },
      '{}': { items: [makeMessage(99, 'tin mới nhất')], older_cursor: null, newer_cursor: null },
    })
    renderAt('/conversations/5?msg=77')
    await screen.findByText('tin được trỏ')

    await userEvent.click(screen.getByRole('button', { name: /Về tin mới nhất/ }))

    expect(await screen.findByText('tin mới nhất')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'url' })).toHaveTextContent('/conversations/5')
    expect(screen.getByRole('status', { name: 'url' })).not.toHaveTextContent('msg=')
  })

  it('a message that no longer exists shows a notice instead of an empty chat', async () => {
    serve({ '{"around":77}': new Error('404') })
    renderAt('/conversations/5?msg=77')
    expect(await screen.findByText(/Không tìm thấy tin này trong cuộc/)).toBeInTheDocument()
  })

  it.each(['0', '-3', 'abc', ''])('ignores a bad ?msg=%s and opens the latest page as usual', async (raw) => {
    serve({ '{}': { items: [makeMessage(99, 'tin mới nhất')], older_cursor: null, newer_cursor: null } })
    renderAt(`/conversations/5?msg=${raw}`)
    expect(await screen.findByText('tin mới nhất')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Về tin mới nhất/ })).toBeNull()
  })
})
