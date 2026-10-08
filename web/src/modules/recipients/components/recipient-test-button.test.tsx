import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RecipientTestButton } from './recipient-test-button'

const post = vi.fn()
const toastSuccess = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — «Gửi thử» cần cả phong bì nên đi qua `httpClient`.
vi.mock('@/core/api', () => ({
  httpClient: { post: (...args: unknown[]) => post(...args) },
  apiGet: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }))

function renderButton(recipientId = 7) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecipientTestButton recipientId={recipientId} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RecipientTestButton', () => {
  it('calls the test endpoint of this recipient and toasts the server message', async () => {
    post.mockResolvedValue({ data: { success: true, message: 'Đã xếp tin thử vào hàng gửi — người nhận thấy tin sau vài giây', data: null } })
    renderButton(7)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử' }))

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/api/recipients/7/test')
    await vi.waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Đã xếp tin thử vào hàng gửi — người nhận thấy tin sau vài giây'),
    )
  })

  it('falls back to a default success toast when the server sends no message', async () => {
    post.mockResolvedValue({ data: { success: true, message: '', data: null } })
    renderButton(3)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử' }))

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã xếp tin thử vào hàng gửi'))
  })

  it('locks the button while a send is in flight so a double click does not queue two messages', async () => {
    let finish: (value: unknown) => void = () => {}
    post.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderButton(7)

    const button = screen.getByRole('button', { name: 'Gửi thử' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(post).toHaveBeenCalledTimes(1)

    finish({ data: { success: true, message: 'ok', data: null } })
    await vi.waitFor(() => expect(button).not.toBeDisabled())
  })

  it('does not toast success when the server rejects (the http client shows the error toast)', async () => {
    post.mockRejectedValue(new Error('403'))
    renderButton(7)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử' }))

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Gửi thử' })).not.toBeDisabled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
