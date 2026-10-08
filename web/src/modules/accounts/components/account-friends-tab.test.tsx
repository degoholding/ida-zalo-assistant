import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BotAccountDetail } from '../types/account'
import { FRIEND_REQUEST_STATUS, type FriendOverview, type FriendRequestRecord } from '../types/friend-request'
import { AccountFriendsTab } from './account-friends-tab'

const apiGet = vi.fn()
const post = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  httpClient: { post: (...args: unknown[]) => post(...args) },
  extractErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'lỗi'),
}))

vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) },
}))

const ACCOUNT = { id: 3, label: 'bot1' } as BotAccountDetail
const DEFAULT_MESSAGE = 'Chào anh/chị, em là Bot trợ lý.'

function makeRequest(overrides: Partial<FriendRequestRecord>): FriendRequestRecord {
  return {
    id: 1, zalo_uid: '2001', display_name: 'Chị Lan', avatar_url: null, message: '', direction: 1, status: FRIEND_REQUEST_STATUS.pending,
    requested_at: '2026-10-08T03:00:00Z', updated_at: '2026-10-08T03:00:00Z', ...overrides,
  }
}

function makeOverview(overrides: Partial<FriendOverview> = {}): FriendOverview {
  return {
    running: true, incoming: [], sent: [], sent_today: 2, daily_cap: 30, default_message: DEFAULT_MESSAGE, max_message_length: 150, ...overrides,
  }
}

function serve(overview: FriendOverview, search?: Record<string, unknown> | Error) {
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/api/accounts/3/friends') return overview
    if (url === '/api/accounts/3/friends/search') {
      if (search instanceof Error) throw search
      return search
    }
    throw new Error(`không mong gọi ${url}`)
  })
}

function renderTab() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <AccountFriendsTab account={ACCOUNT} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AccountFriendsTab', () => {
  it('searches a phone number and sends a friend request with the default message', async () => {
    serve(makeOverview(), { uid: '2001', display_name: 'Chị Lan', zalo_name: 'Lan', avatar_url: 'https://ava/lan.jpg', relation: 'none' })
    post.mockResolvedValue({ data: { data: { status: FRIEND_REQUEST_STATUS.pending, sent_today: 3, daily_cap: 30 }, message: 'Đã gửi lời mời kết bạn' } })
    renderTab()

    await userEvent.type(await screen.findByRole('textbox', { name: 'Số điện thoại' }), '0912 345 678')
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }))

    expect(await screen.findByText('Chị Lan')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/api/accounts/3/friends/search', { params: { phone: '0912 345 678' } })
    expect(screen.getByRole('textbox', { name: 'Lời nhắn kèm lời mời' })).toHaveValue(DEFAULT_MESSAGE)

    await userEvent.click(screen.getByRole('button', { name: 'Gửi lời mời' }))

    expect(post).toHaveBeenCalledWith('/api/accounts/3/friends/requests', {
      uid: '2001', message: DEFAULT_MESSAGE, display_name: 'Chị Lan', avatar_url: 'https://ava/lan.jpg',
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã gửi lời mời kết bạn'))
    // Thẻ kết quả đổi sang «đã mời» mà không tra lại số trên Zalo
    expect(await screen.findByText(/Bot đã mời, đang chờ/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gửi lời mời' })).toBeNull()
    expect(apiGet.mock.calls.filter(([url]) => url === '/api/accounts/3/friends/search')).toHaveLength(1)
  })

  it('shows the server error for an unknown number and offers no send button', async () => {
    serve(makeOverview(), new Error('Không tìm thấy tài khoản Zalo của số này'))
    renderTab()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Số điện thoại' }), '0987654321')
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }))
    expect(await screen.findByText('Không tìm thấy tài khoản Zalo của số này')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gửi lời mời' })).toBeNull()
  })

  it('does not search on an empty or blank phone', async () => {
    serve(makeOverview())
    renderTab()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Số điện thoại' }), '   ')
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeDisabled()
    expect(apiGet).not.toHaveBeenCalledWith('/api/accounts/3/friends/search', expect.anything())
  })

  it('blocks sending once the daily cap is reached', async () => {
    serve(makeOverview({ sent_today: 30 }), { uid: '2001', display_name: 'Chị Lan', zalo_name: '', avatar_url: '', relation: 'none' })
    renderTab()
    await userEvent.type(await screen.findByRole('textbox', { name: 'Số điện thoại' }), '0912345678')
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }))
    expect(await screen.findByRole('button', { name: 'Gửi lời mời' })).toBeDisabled()
    expect(screen.getByText(/Đã đủ số lời mời hôm nay/)).toBeInTheDocument()
  })

  it('accepts and rejects incoming requests through the right endpoints', async () => {
    serve(makeOverview({ incoming: [makeRequest({ id: 1, zalo_uid: '2001', display_name: 'Chị Lan' }), makeRequest({ id: 2, zalo_uid: '2002', display_name: 'Anh Bình' })] }))
    post.mockResolvedValue({ data: { data: null, message: 'Đã xong' } })
    renderTab()

    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý Chị Lan' }))
    expect(post).toHaveBeenCalledWith('/api/accounts/3/friends/incoming/2001/accept', undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Từ chối Anh Bình' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối Anh Bình' }))
    expect(post).toHaveBeenCalledWith('/api/accounts/3/friends/incoming/2002/reject', undefined)
  })

  it('cancels only pending sent requests and labels the others by status', async () => {
    serve(makeOverview({
      sent: [
        makeRequest({ id: 5, zalo_uid: '3001', display_name: 'Chờ', direction: 2, status: FRIEND_REQUEST_STATUS.pending }),
        makeRequest({ id: 6, zalo_uid: '3002', display_name: 'Bạn rồi', direction: 2, status: FRIEND_REQUEST_STATUS.accepted }),
        makeRequest({ id: 7, zalo_uid: '3003', display_name: 'Từ chối', direction: 2, status: FRIEND_REQUEST_STATUS.rejected }),
      ],
    }))
    post.mockResolvedValue({ data: { data: null, message: 'Đã rút lại lời mời kết bạn' } })
    renderTab()

    expect(await screen.findByText('Đã là bạn')).toBeInTheDocument()
    expect(screen.getByText('Bị từ chối / hết hạn')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Hủy lời mời/ })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Hủy lời mời Chờ' }))
    expect(post).toHaveBeenCalledWith('/api/accounts/3/friends/requests/3001/cancel', undefined)
  })

  it('with the bot offline, shows the lists read-only and explains why', async () => {
    serve(makeOverview({ running: false, incoming: [makeRequest({})] }))
    renderTab()
    expect(await screen.findByText(/Tài khoản bot đang tắt hoặc chưa kết nối Zalo/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Số điện thoại' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Đồng ý Chị Lan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Làm mới/ })).toBeDisabled()
  })

  it('«Làm mới» asks the server to re-check Zalo now', async () => {
    serve(makeOverview())
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: /Làm mới/ }))
    expect(apiGet).toHaveBeenCalledWith('/api/accounts/3/friends', { params: { refresh: 1 } })
  })
})
