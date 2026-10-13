import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialogHost } from '@/shared/ui/confirm-dialog'
import { REPLY_TEMPLATE_STATUS, type ReplyTemplate } from '../types/reply-template'
import { ReplyTemplateActionButtons } from './reply-template-action-buttons'

const post = vi.fn()
let permissions: Record<string, Record<string, boolean>> = {}

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — thao tác cần cả phong bì nên đi qua `httpClient`.
vi.mock('@/core/api', () => ({
  httpClient: { post: (...args: unknown[]) => post(...args) },
  apiGet: vi.fn(),
}))

vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { permissions: typeof permissions } }) => unknown) => selector({ user: { permissions } }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const makeTemplate = (overrides: Partial<ReplyTemplate> = {}): ReplyTemplate => ({
  id: 4, name: 'Báo giá', situation: '', keywords: '', body: 'Dạ em gửi giá [giá]', tone: 1, status: REPLY_TEMPLATE_STATUS.pendingReview,
  author_user_id: 7, author_name: 'Lan', reviewer_user_id: null, reviewer_name: '', review_note: '', submitted_at: null, reviewed_at: null,
  created_at: '2026-10-12T01:00:00Z', updated_at: '2026-10-12T01:00:00Z', can_edit: true, can_review: false, ...overrides,
})

function renderButtons(template: ReplyTemplate) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ReplyTemplateActionButtons template={template} />
      <ConfirmDialogHost />
    </QueryClientProvider>,
  )
}

const buttonNames = () => screen.queryAllByRole('button').map((button) => button.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  permissions = { reply_template: { read: true, write: true, create: true, approve: true } }
  post.mockResolvedValue({ data: { success: true, message: 'Đã duyệt mẫu', data: makeTemplate() } })
})

describe('ReplyTemplateActionButtons', () => {
  it('hides approve / return from a staff author on a pending template', () => {
    renderButtons(makeTemplate({ can_review: false }))
    expect(buttonNames()).toEqual([])
  })

  it('shows approve, return and archive to a reviewer on a pending template', () => {
    renderButtons(makeTemplate({ can_review: true }))
    expect(buttonNames()).toEqual(['Duyệt', 'Trả lại', 'Ngừng dùng'])
  })

  it('shows submit on a draft the user can edit', () => {
    renderButtons(makeTemplate({ status: REPLY_TEMPLATE_STATUS.draft }))
    expect(buttonNames()).toEqual(['Gửi duyệt'])
  })

  it('renders nothing without write permission', () => {
    permissions = { reply_template: { read: true } }
    renderButtons(makeTemplate({ can_review: true }))
    expect(buttonNames()).toEqual([])
  })

  it('posts the approve action', async () => {
    renderButtons(makeTemplate({ can_review: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }))
    expect(post).toHaveBeenCalledWith('/api/reply-templates/4/actions', { action: 'approve' })
  })

  it('requires a return note of at least 5 characters before sending', async () => {
    renderButtons(makeTemplate({ can_review: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Trả lại' }))
    const submit = screen.getAllByRole('button', { name: 'Trả lại' }).at(-1)!
    expect(submit).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Ghi chú trả lại/), 'Thiếu hạn báo giá')
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    expect(post).toHaveBeenCalledWith('/api/reply-templates/4/actions', { action: 'return', note: 'Thiếu hạn báo giá' })
  })
})
