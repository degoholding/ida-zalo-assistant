import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssistantChatPage } from './assistant-chat-page'

const apiGet = vi.fn()
const apiPost = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  extractErrorMessage: () => 'Có lỗi xảy ra',
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AssistantChatPage />
    </QueryClientProvider>,
  )
}

function mockAskers(data: { assistant_on: boolean; askers: { id: number; name: string; role: number }[] }) {
  apiGet.mockImplementation((url: string) => (url.endsWith('/askers') ? Promise.resolve(data) : Promise.resolve([])))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AssistantChatPage', () => {
  it('explains how to grant a role when nobody in the contact book has one', async () => {
    mockAskers({ assistant_on: true, askers: [] })
    renderPage()

    expect(await screen.findByText('Chưa có ai có vai trò')).toBeInTheDocument()
    expect(screen.getByText(/Danh bạ/)).toBeInTheDocument()
    expect(screen.getByText(/seed:demo/)).toBeInTheDocument()
    // Không có người hỏi thì không hiện ô chọn người hỏi
    expect(screen.queryByLabelText('Người hỏi')).toBeNull()
  })

  it('shows a warning banner and disables the question input when the assistant is off', async () => {
    mockAskers({ assistant_on: false, askers: [{ id: 1, name: 'Duy', role: 2 }] })
    renderPage()

    expect(await screen.findByText(/Trợ lý AI đang tắt/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Câu hỏi')).toBeDisabled()
  })

  it('enables the input and shows suggestion chips once an asker is picked and the assistant is on', async () => {
    mockAskers({ assistant_on: true, askers: [{ id: 1, name: 'Duy', role: 2 }] })
    renderPage()

    expect(await screen.findByLabelText('Câu hỏi')).not.toBeDisabled()
    expect(await screen.findByText('Tóm tắt các nhóm hôm nay')).toBeInTheDocument()
    expect(screen.queryByText(/Trợ lý AI đang tắt/)).toBeNull()
  })

  it('shows an error state with a retry button when the askers call fails', async () => {
    apiGet.mockRejectedValue(new Error('network'))
    renderPage()

    expect(await screen.findByText('Không tải được danh sách người hỏi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
  })
})
