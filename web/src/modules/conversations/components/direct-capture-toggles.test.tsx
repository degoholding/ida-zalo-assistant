import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ThreadDetail } from '../types/conversation'
import { DirectCaptureToggles } from './direct-capture-toggles'

const apiPatch = vi.fn()

// Mock ở tầng `@/core/api` theo luật test — API PATCH thật nằm ở nhánh Agent 2, ở đây giả lập đúng hợp đồng
vi.mock('@/core/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: (...args: unknown[]) => apiPatch(...args),
  httpClient: { post: vi.fn(), get: vi.fn() },
  extractErrorMessage: () => 'Thân yêu cầu không hợp lệ',
}))

let isAdmin = true
vi.mock('@/core/authorization/use-permission', () => ({
  usePermission: () => ({ can: (entity: string, action: string) => entity === 'setting' && action === 'write' && isAdmin }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }))

function makeThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 41, thread_type: 2, name: 'Anh Tùng', label: '', display_name: 'Anh Tùng', zalo_group_id: 'u123', company_id: null,
    message_count: 12, last_message_at: null, last_text: null, last_sender: null, last_from_bot: false, avatar_url: null,
    bot_name: 'Lạc Lạc', collect_only: false, contact: null, group: null,
    read_messages: true, capture_files: false,
    ...overrides,
  }
}

function renderToggles(thread: ThreadDetail) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DirectCaptureToggles thread={thread} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  isAdmin = true
  apiPatch.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('DirectCaptureToggles (cuộc riêng 1-1)', () => {
  it('is hidden from non-admins and when the server does not send the two flags yet', () => {
    isAdmin = false
    renderToggles(makeThread())
    expect(screen.queryByRole('switch')).toBeNull()
    isAdmin = true
    renderToggles(makeThread({ read_messages: undefined, capture_files: undefined }))
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows both switches with the current state and the hint that switching off keeps old messages', () => {
    renderToggles(makeThread({ read_messages: 1, capture_files: 0 }))
    expect(screen.getByRole('switch', { name: 'Đọc tin' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Lấy file' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Tắt chỉ chặn tin từ lúc tắt, tin cũ vẫn còn.')).toBeTruthy()
  })

  it('PATCHes only the flag that changed and toasts the result', async () => {
    apiPatch.mockResolvedValue(makeThread({ capture_files: true }))
    renderToggles(makeThread())
    fireEvent.click(screen.getByRole('switch', { name: 'Lấy file' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/conversations/41', { capture_files: true }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã bật Lấy file'))

    fireEvent.click(screen.getByRole('switch', { name: 'Đọc tin' }))
    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith('/api/conversations/41', { read_messages: false }))
    await waitFor(() => expect(toastSuccess).toHaveBeenLastCalledWith('Đã tắt Đọc tin'))
  })

  it('shows the server error (e.g. 422) as a toast', async () => {
    apiPatch.mockRejectedValue(new Error('422'))
    renderToggles(makeThread())
    fireEvent.click(screen.getByRole('switch', { name: 'Đọc tin' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Thân yêu cầu không hợp lệ'))
  })
})
