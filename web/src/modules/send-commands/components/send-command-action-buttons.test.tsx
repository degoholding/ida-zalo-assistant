import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialogHost } from '@/shared/ui/confirm-dialog'
import { SEND_COMMAND_SOURCE, SEND_COMMAND_STATUS, type SendCommandDetail } from '../types/send-command'
import { SendCommandActionButtons } from './send-command-action-buttons'

const post = vi.fn()
const toastSuccess = vi.fn()
let permissions: Record<string, Record<string, boolean>> = {}
let role = 1

vi.mock('@/core/api', () => ({
  httpClient: { post: (...args: unknown[]) => post(...args) },
  apiGet: vi.fn(),
}))

vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { role: number; permissions: typeof permissions } }) => unknown) =>
    selector({ user: { role, permissions } }),
}))

vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }))

const makeCommand = (overrides: Partial<SendCommandDetail> = {}): SendCommandDetail => ({
  id: 12, source: SEND_COMMAND_SOURCE.zalo, status: SEND_COMMAND_STATUS.scheduled, action_kind: 1, reminder_at: null, reminder_repeat: 0, requester_uid: 'u1', requester_name: 'Chị Lan',
  scheduled_at: '2026-10-13T01:00:00Z', off_hours_note: '', cancelled_by: '', created_at: '2026-10-12T01:00:00Z', reported_at: null,
  body_preview: 'Họp 9h', body_truncated: false, target_count: 3, sent_count: 0, failed_count: 0, body: 'Họp 9h', files: [], targets: [],
  ...overrides,
})

function renderButtons(command: SendCommandDetail) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SendCommandActionButtons command={command} />
      <ConfirmDialogHost />
    </QueryClientProvider>,
  )
}

const buttonNames = () => screen.queryAllByRole('button').map((button) => button.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  role = 1
  permissions = { send_command: { read: true, write: true } }
  post.mockResolvedValue({ data: { success: true, message: 'Đã hủy lệnh G-12.', data: makeCommand() } })
})

describe('SendCommandActionButtons', () => {
  it('shows "Hủy lệnh" on a scheduled command', () => {
    renderButtons(makeCommand())
    expect(buttonNames()).toEqual(['Hủy lệnh'])
  })

  it('shows resend to admins when a finished command has failed targets', () => {
    renderButtons(makeCommand({ status: SEND_COMMAND_STATUS.done, failed_count: 1 }))
    expect(buttonNames()).toEqual(['Gửi lại nơi lỗi'])
  })

  it('hides resend from a non-admin even with failed targets (server answers 403 anyway)', () => {
    role = 2
    renderButtons(makeCommand({ status: SEND_COMMAND_STATUS.done, failed_count: 2 }))
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('lets a non-admin cancel their own scheduled command', () => {
    role = 3
    renderButtons(makeCommand())
    expect(buttonNames()).toEqual(['Hủy lệnh'])
  })

  it('shows nothing on a cancelled command or without write permission', () => {
    renderButtons(makeCommand({ status: SEND_COMMAND_STATUS.cancelled }))
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('posts nothing until the confirm prompt is accepted, then toasts the server message', async () => {
    renderButtons(makeCommand())
    await userEvent.click(screen.getByRole('button', { name: 'Hủy lệnh' }))
    expect(post).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole('button', { name: 'Hủy lệnh' }).at(-1) as HTMLElement)

    expect(post).toHaveBeenCalledWith('/api/send-commands/12/actions', { action: 'cancel' })
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã hủy lệnh G-12.'))
  })

  it('renders nothing for a user without send_command.write', () => {
    permissions = { send_command: { read: true, write: false } }
    renderButtons(makeCommand())
    expect(screen.queryAllByRole('button')).toEqual([])
  })
})
