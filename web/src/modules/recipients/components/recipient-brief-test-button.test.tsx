import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RecipientBriefTestButton } from './recipient-brief-test-button'

const post = vi.fn()
const toastSuccess = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — «Gửi thử bản tin» cần cả phong bì nên đi qua `httpClient`.
vi.mock('@/core/api', () => ({
  httpClient: { post: (...args: unknown[]) => post(...args) },
  apiGet: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }))

function renderButton(recipientId = 7) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RecipientBriefTestButton recipientId={recipientId} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RecipientBriefTestButton', () => {
  it('opens a menu with the four brief / report kinds', async () => {
    renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử bản tin' }))

    expect(screen.getByRole('menuitem', { name: 'Bản tin sáng' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Bản tin cuối ngày' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Báo cáo tuần' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Báo cáo tháng' })).toBeInTheDocument()
  })

  it('calls the brief-test endpoint of this recipient with the chosen kind and toasts the server message', async () => {
    post.mockResolvedValue({ data: { success: true, message: 'Đã xếp bản tin vào hàng gửi — người nhận thấy sau vài giây', data: null } })
    renderButton(7)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử bản tin' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Báo cáo tuần' }))

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/api/recipients/7/brief-test', { kind: 3 })
    await vi.waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Đã xếp bản tin vào hàng gửi — người nhận thấy sau vài giây'),
    )
  })

  it('sends the morning kind code (1) when that menu item is picked', async () => {
    post.mockResolvedValue({ data: { success: true, message: '', data: null } })
    renderButton(3)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử bản tin' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bản tin sáng' }))

    expect(post).toHaveBeenCalledWith('/api/recipients/3/brief-test', { kind: 1 })
  })

  it('falls back to a default success toast when the server sends no message', async () => {
    post.mockResolvedValue({ data: { success: true, message: '', data: null } })
    renderButton(3)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử bản tin' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bản tin cuối ngày' }))

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã xếp bản tin vào hàng gửi'))
  })

  it('locks the trigger button while a send is in flight so a double click does not queue two messages', async () => {
    let finish: (value: unknown) => void = () => {}
    post.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderButton(7)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử bản tin' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Báo cáo tháng' }))

    const trigger = screen.getByRole('button', { name: 'Gửi thử bản tin' })
    expect(trigger).toBeDisabled()
    expect(post).toHaveBeenCalledTimes(1)

    finish({ data: { success: true, message: 'ok', data: null } })
    await vi.waitFor(() => expect(trigger).not.toBeDisabled())
  })

  it('does not toast success when the server rejects (the http client shows the error toast)', async () => {
    post.mockRejectedValue(new Error('403'))
    renderButton(7)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi thử bản tin' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bản tin sáng' }))

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Gửi thử bản tin' })).not.toBeDisabled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})
