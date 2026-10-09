import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialogHost } from '@/shared/ui/confirm-dialog'
import { TASK_STATUS, type TaskDetail } from '../types/task'
import { TaskActionButtons } from './task-action-buttons'

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

const makeTask = (overrides: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 12, code: 'V-0012', status: TASK_STATUS.open, priority: 2, title: 'Gửi báo giá cho khách XT',
  assignee_contact_id: 3, assignee_name: 'Minh', assigner_name: 'Chị Lan', source: 1, source_thread_id: null,
  source_thread_name: '', due_at: null, due_has_time: false, overdue: false, missing_assignee: false, missing_due: true,
  created_at: '2026-10-08T01:00:00Z', resolution: '', updated_at: '2026-10-08T01:00:00Z', confirmed_at: null, closed_at: null,
  source_message_id: null, events: [], ...overrides,
})

function renderButtons(task: TaskDetail) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TaskActionButtons task={task} />
      {/* Nút Xác nhận / Bỏ / Mở lại đi qua hộp thoại `confirm()` dùng chung — cần có host này mới hiện ra được. */}
      <ConfirmDialogHost />
    </QueryClientProvider>,
  )
}

const buttonNames = () => screen.queryAllByRole('button').map((button) => button.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  permissions = { task: { read: true, write: true } }
  post.mockResolvedValue({ data: { success: true, message: 'Xong V-0012 — đã báo qua Zalo', data: makeTask() } })
})

describe('TaskActionButtons', () => {
  it('shows confirm/reject on a pending proposal, nothing else', () => {
    renderButtons(makeTask({ status: TASK_STATUS.proposed }))
    expect(buttonNames()).toEqual(['Xác nhận', 'Bỏ'])
  })

  it('shows the full work actions on an open task', () => {
    renderButtons(makeTask({ status: TASK_STATUS.open }))
    expect(buttonNames()).toEqual(['Xong', 'Dời hạn', 'Giao lại', 'Ghi chú', 'Hủy'])
  })

  it('shows only reopen on a done task', () => {
    renderButtons(makeTask({ status: TASK_STATUS.done }))
    expect(buttonNames()).toEqual(['Mở lại'])
  })

  it('shows only reopen on a cancelled task', () => {
    renderButtons(makeTask({ status: TASK_STATUS.cancelled }))
    expect(buttonNames()).toEqual(['Mở lại'])
  })

  it('shows nothing to a staff member who can only read tasks', () => {
    permissions = { task: { read: true, write: false } }
    renderButtons(makeTask())
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('will not send an empty note for the required "Ghi chú" action', async () => {
    renderButtons(makeTask({ status: TASK_STATUS.open }))
    await userEvent.click(screen.getByRole('button', { name: 'Ghi chú' }))

    const send = screen.getByRole('button', { name: 'Gửi' })
    expect(send).toBeDisabled()
    //  Chỉ dấu cách thì máy chủ cắt còn rỗng và trả 422 — chặn luôn ở đây.
    await userEvent.type(screen.getByLabelText(/Nội dung/), '   ')
    expect(send).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/Nội dung/), 'Khách đổi ý, chờ báo giá lại')
    await userEvent.click(send)
    expect(post).toHaveBeenCalledWith('/api/tasks/12/actions', { action: 'note', note: 'Khách đổi ý, chờ báo giá lại' })
  })

  it('lets "Xong" go through without a note and omits the empty note from the request', async () => {
    renderButtons(makeTask({ status: TASK_STATUS.open }))
    await userEvent.click(screen.getByRole('button', { name: 'Xong' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Báo xong' }).at(-1) as HTMLElement)

    expect(post).toHaveBeenCalledWith('/api/tasks/12/actions', { action: 'done', note: undefined })
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Xong V-0012 — đã báo qua Zalo'))
  })

  it('confirms after the confirm prompt', async () => {
    renderButtons(makeTask({ status: TASK_STATUS.proposed }))
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Xác nhận' }).at(-1) as HTMLElement)

    expect(post).toHaveBeenCalledWith('/api/tasks/12/actions', { action: 'confirm' })
  })
})
