import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GoogleCalendarConnectPanel } from './google-calendar-connect-panel'
import type { GoogleOauthStatus } from '../types/setting'

const apiGet = vi.fn()
const apiPost = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  extractErrorMessage: () => 'Có lỗi xảy ra',
}))

function makeStatus(overrides: Partial<GoogleOauthStatus>): GoogleOauthStatus {
  return {
    client_configured: true,
    connected: false,
    email: '',
    redirect_uri: 'http://localhost:8090/api/google/oauth/callback',
    drive_scope_granted: false,
    ...overrides,
  }
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <GoogleCalendarConnectPanel />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GoogleCalendarConnectPanel', () => {
  it('shows the connected email and a disconnect button once connected', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: true, email: 'quanly@gmail.com' }))
    renderCard()

    expect(await screen.findByText('Đã kết nối: quanly@gmail.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ngắt kết nối/ })).toBeInTheDocument()
  })

  it('shows "Chưa kết nối" and no disconnect button when not connected', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: false }))
    renderCard()

    expect(await screen.findByText('Chưa kết nối')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ngắt kết nối/ })).toBeNull()
  })

  it('disables the connect button and explains why when the OAuth client is not configured', async () => {
    apiGet.mockResolvedValue(makeStatus({ client_configured: false }))
    renderCard()

    // Chờ status tải xong (nút bật/tắt đổi CÙNG lúc với lúc hết loading) rồi mới đọc
    // `disabled` — không chờ thì `findByRole` bắt trúng nút ở lần render đầu (đang loading),
    // test luôn pass dù logic disable sau này có hỏng.
    await screen.findByText('Chưa kết nối')
    const connectButton = screen.getByRole('button', { name: /Kết nối Google/ })
    expect(connectButton).toBeDisabled()
    expect(screen.getByText('Chép Client ID và Client secret vào hai ô phía trên và Lưu trước.')).toBeInTheDocument()
  })

  it('enables the connect button when the client is configured, with no explanation text', async () => {
    apiGet.mockResolvedValue(makeStatus({ client_configured: true }))
    renderCard()

    await screen.findByText('Chưa kết nối')
    const connectButton = screen.getByRole('button', { name: /Kết nối Google/ })
    expect(connectButton).not.toBeDisabled()
    expect(screen.queryByText(/Chép Client ID và Client secret/)).toBeNull()
  })

  it('calls start and navigates the browser to auth_url when the connect button is clicked', async () => {
    apiGet.mockResolvedValue(makeStatus({ client_configured: true }))
    apiPost.mockResolvedValue({ auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc' })

    // jsdom không cho `vi.spyOn(window.location, 'assign')` (thuộc tính không ghi lại được trên
    // Location.prototype) — phải thay cả object `location` rồi trả lại nguyên bản sau khi xong.
    const originalLocation = window.location
    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign: assignMock },
    })

    try {
      renderCard()
      await screen.findByText('Chưa kết nối')
      const connectButton = screen.getByRole('button', { name: /Kết nối Google/ })
      await userEvent.click(connectButton)

      expect(apiPost).toHaveBeenCalledWith('/api/google/oauth/start')
      expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?client_id=abc')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('shows the redirect URI with a copy button so the admin can register it on Google Cloud', async () => {
    apiGet.mockResolvedValue(makeStatus({}))
    renderCard()

    expect(await screen.findByText('http://localhost:8090/api/google/oauth/callback')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chép|copy/i })).toBeInTheDocument()
  })
})
