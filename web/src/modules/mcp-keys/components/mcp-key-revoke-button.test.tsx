import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialogHost } from '@/shared/ui/confirm-dialog'
import type { McpKeyDetail } from '../types/mcp-key'
import { McpKeyRevokeButton } from './mcp-key-revoke-button'

const post = vi.fn()
const toastSuccess = vi.fn()

vi.mock('@/core/api', () => ({ httpClient: { post: (...args: unknown[]) => post(...args) }, apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }))
vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { permissions: Record<string, Record<string, boolean>> } }) => unknown) =>
    selector({ user: { permissions: { mcp_key: { read: true, write: true } } } }),
}))

const makeKey = (overrides: Partial<McpKeyDetail> = {}): McpKeyDetail => ({
  id: 5, user_id: 1, name: 'Claude máy tôi', prefix: 'ab12cd34', access_level: 1, include_confidential: false, expires_at: null,
  last_used_at: null, last_used_ip: null, revoked_at: null, created_at: '2026-10-17T00:00:00Z', owner_name: 'A', status: 'active', ...overrides,
})

function renderButton(mcpKey: McpKeyDetail) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <McpKeyRevokeButton mcpKey={mcpKey} />
      <ConfirmDialogHost />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('McpKeyRevokeButton', () => {
  it('asks for confirmation and only then revokes this key', async () => {
    post.mockResolvedValue({ data: { success: true, message: 'Đã thu hồi khóa', data: {} } })
    renderButton(makeKey())

    await userEvent.click(screen.getByRole('button', { name: 'Thu hồi' }))
    expect(post).not.toHaveBeenCalled()
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Thu hồi' }))

    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/mcp-keys/5/revoke'))
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã thu hồi khóa'))
  })

  it('does not revoke when the confirmation is cancelled', async () => {
    renderButton(makeKey())
    await userEvent.click(screen.getByRole('button', { name: 'Thu hồi' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Hủy' }))
    expect(post).not.toHaveBeenCalled()
  })

  it('renders nothing for a key that is already revoked', () => {
    renderButton(makeKey({ revoked_at: '2026-10-17T01:00:00Z', status: 'revoked' }))
    expect(screen.queryByRole('button', { name: 'Thu hồi' })).not.toBeInTheDocument()
  })
})
