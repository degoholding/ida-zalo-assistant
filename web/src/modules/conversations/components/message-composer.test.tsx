import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageComposer } from './message-composer'

const apiPost = vi.fn()
const httpPost = vi.fn()

// Mock ở tầng `@/core/api` theo luật test — hook và api của phân hệ chạy thật.
vi.mock('@/core/api', () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiGet: vi.fn(),
  httpClient: { post: (...args: unknown[]) => httpPost(...args), get: vi.fn() },
  extractErrorMessage: () => 'lỗi',
}))

let permissions: Record<string, Record<string, boolean>> = {}
vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { permissions } }),
}))

function renderComposer() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MessageComposer threadId={5} botName="Bot" />
    </QueryClientProvider>,
  )
  return screen.queryByLabelText('Nội dung tin') as HTMLTextAreaElement
}

const enter = (box: HTMLElement) => fireEvent.keyDown(box, { key: 'Enter' })

beforeEach(() => {
  apiPost.mockReset()
  httpPost.mockReset()
  permissions = { conversation: { read: true, write: true } }
})

describe('MessageComposer', () => {
  it('sends once when Enter is pressed twice before the first send settles', async () => {
    // Lỗi cũ: Enter đúp gửi cùng một tin hai lần vào nhóm Zalo thật
    let resolve: (value: unknown) => void = () => {}
    apiPost.mockReturnValue(new Promise((r) => { resolve = r }))
    const box = renderComposer()
    fireEvent.change(box, { target: { value: 'xin chào' } })
    enter(box)
    enter(box)
    resolve({ message_id: 1 })
    await waitFor(() => expect(box.value).toBe(''))
    expect(apiPost).toHaveBeenCalledTimes(1)
  })

  it('keeps the typed text when sending fails', async () => {
    // Lỗi cũ: chữ bị xóa dù gửi thất bại
    apiPost.mockRejectedValue(new Error('403'))
    const box = renderComposer()
    fireEvent.change(box, { target: { value: 'đừng mất tôi' } })
    enter(box)
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: /Gửi/ })).toBeEnabled())
    expect(box.value).toBe('đừng mất tôi')
  })

  it('allows retry after a failure and clears text after success', async () => {
    apiPost.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ message_id: 2 })
    const box = renderComposer()
    fireEvent.change(box, { target: { value: 'thử lại' } })
    enter(box)
    await waitFor(() => expect(screen.getByRole('button', { name: /Gửi/ })).toBeEnabled())
    enter(box)
    await waitFor(() => expect(box.value).toBe(''))
    expect(apiPost).toHaveBeenCalledTimes(2)
  })

  it('ignores whitespace-only text and Shift+Enter', () => {
    const box = renderComposer()
    fireEvent.change(box, { target: { value: '   ' } })
    enter(box)
    fireEvent.change(box, { target: { value: 'dòng 1' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('keeps a failed file in the list and never sends a file twice on double Enter', async () => {
    let resolve: (value: unknown) => void = () => {}
    httpPost.mockReturnValueOnce(new Promise((r) => { resolve = r })).mockRejectedValueOnce(new Error('x'))
    const box = renderComposer()
    const input = screen.getByLabelText('Chọn tệp đính kèm')
    const a = new File(['a'], 'a.txt')
    const b = new File(['b'], 'b.txt')
    fireEvent.change(input, { target: { files: [a, b] } })
    enter(box)
    enter(box)
    resolve({ data: { data: { message_id: 1 }, message: 'ok' } })
    await waitFor(() => expect(httpPost).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: /Gửi/ })).toBeEnabled())
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
    expect(screen.getByText('b.txt')).toBeInTheDocument()
  })

  it('renders no composer for users without conversation write permission', () => {
    // Nhân viên: chỉ đọc — gửi sẽ ăn 403 và mất chữ
    permissions = { conversation: { read: true } }
    const box = renderComposer()
    expect(box).toBeNull()
    expect(screen.queryByRole('button', { name: /Gửi/ })).not.toBeInTheDocument()
  })
})
