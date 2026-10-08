import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TICKET_STATUS, type Ticket } from '../types/ticket'
import { TicketActionButtons } from './ticket-action-buttons'

const post = vi.fn()
const toastSuccess = vi.fn()
let permissions: Record<string, Record<string, boolean>> = {}

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — thao tác cần cả phong bì nên đi qua `httpClient`.
vi.mock('@/core/api', () => ({
  httpClient: { post: (...args: unknown[]) => post(...args) },
  apiGet: vi.fn(),
}))

vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { permissions: typeof permissions } }) => unknown) =>
    selector({ user: { permissions } }),
}))

vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }))

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 12, code: 'T-0012', status: TICKET_STATUS.new, title: 'Máy in phòng kế toán hỏng', body: '', requester_name: 'Chị Mai',
  requester_uid: 'u1', handler_name: '', resolution: '', source_kind: 'group', source_name: 'Kế toán', attachment_count: 0,
  created_at: '2026-10-08T01:00:00Z', updated_at: '2026-10-08T01:00:00Z', accepted_at: null, closed_at: null, ...overrides,
})

function renderButtons(ticket: Ticket) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TicketActionButtons ticket={ticket} />
    </QueryClientProvider>,
  )
}

const buttonNames = () => screen.queryAllByRole('button').map((button) => button.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  permissions = { ticket: { read: true, write: true } }
  post.mockResolvedValue({ data: { success: true, message: 'Nhận xử lý — đã báo qua Zalo', data: makeTicket() } })
})

describe('TicketActionButtons', () => {
  it('shows the buttons that fit each status', () => {
    renderButtons(makeTicket({ status: TICKET_STATUS.new }))
    expect(buttonNames()).toEqual(['Nhận xử lý', 'Báo xong', 'Nhắn người gửi', 'Hủy'])
  })

  it('shows reopen but not done / cancel on a closed ticket', () => {
    renderButtons(makeTicket({ status: TICKET_STATUS.cancelled }))
    expect(buttonNames()).toEqual(['Mở lại', 'Nhắn người gửi'])
  })

  it('shows nothing to a staff member who can only read tickets', () => {
    permissions = { ticket: { read: true, write: false } }
    renderButtons(makeTicket())
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('accepts straight away and toasts the server message', async () => {
    renderButtons(makeTicket())
    await userEvent.click(screen.getByRole('button', { name: 'Nhận xử lý' }))

    expect(post).toHaveBeenCalledWith('/api/tickets/12/actions', { action: 'accept' })
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Nhận xử lý — đã báo qua Zalo'))
  })

  it('will not send an empty message to the requester', async () => {
    renderButtons(makeTicket())
    await userEvent.click(screen.getByRole('button', { name: 'Nhắn người gửi' }))

    const send = screen.getByRole('button', { name: 'Gửi' })
    expect(send).toBeDisabled()
    //  Chỉ dấu cách thì máy chủ cắt còn rỗng và trả 422 — chặn luôn ở đây.
    await userEvent.type(screen.getByLabelText(/Nội dung nhắn/), '   ')
    expect(send).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/Nội dung nhắn/), 'Anh gửi lại ảnh lỗi giúp em')
    await userEvent.click(send)
    expect(post).toHaveBeenCalledWith('/api/tickets/12/actions', { action: 'note', note: 'Anh gửi lại ảnh lỗi giúp em' })
  })

  it('lets done go through without a note and omits the empty note from the request', async () => {
    renderButtons(makeTicket({ status: TICKET_STATUS.inProgress }))
    await userEvent.click(screen.getByRole('button', { name: 'Báo xong' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Báo xong' }).at(-1) as HTMLElement)

    expect(post).toHaveBeenCalledWith('/api/tickets/12/actions', { action: 'done', note: undefined })
  })
})
