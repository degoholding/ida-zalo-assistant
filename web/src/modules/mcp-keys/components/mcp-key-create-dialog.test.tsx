import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrudFormDialogProps } from '@/shared/crud/types'
import type { McpKeyDetail, McpKeyOptions } from '../types/mcp-key'
import { McpKeyCreateDialog } from './mcp-key-create-dialog'

const apiGet = vi.fn()
const apiPost = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`).
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  httpClient: { post: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const TOKEN = 'idamcp_ab12cd34_thisIsTheOnlyTimeYouSeeMe0123456789'
const STAFF: McpKeyOptions = { max_access_level: 1, can_include_confidential: false, expiry_days: [30, 90, 365], is_admin: false }
const MANAGER_WITH_SECRET: McpKeyOptions = { max_access_level: 2, can_include_confidential: true, expiry_days: [30, 90, 365], is_admin: false }

function renderDialog(options: McpKeyOptions) {
  apiGet.mockResolvedValue(options)
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const props = { open: true, onOpenChange, config: {} } as unknown as CrudFormDialogProps<McpKeyDetail>
  const view = render(
    <QueryClientProvider client={client}>
      <McpKeyCreateDialog {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange, client, view }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('McpKeyCreateDialog', () => {
  it('shows the raw key once with ready-to-paste snippets built from the current origin, then forgets it', async () => {
    apiPost.mockResolvedValue({ key: { id: 3 }, token: TOKEN })
    const { onOpenChange, view, client } = renderDialog(STAFF)

    await userEvent.type(screen.getByLabelText('Tên khóa'), '  Claude máy tôi ')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo khóa' }))

    expect(apiPost).toHaveBeenCalledWith('/api/mcp-keys', { name: 'Claude máy tôi', access_level: 1, include_confidential: false, expires_in_days: 90 })
    expect(await screen.findByText(/Chỉ hiện một lần/)).toBeInTheDocument()
    expect(screen.getByTestId('mcp-key-token')).toHaveTextContent(TOKEN)
    const mcpUrl = `${window.location.origin}/mcp`
    expect(screen.getByText(new RegExp(`claude mcp add --transport http ida-bot ${mcpUrl.replace(/[/.]/g, '\\$&')}`))).toBeInTheDocument()
    expect(screen.getByText(/bearer_token_env_var/)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(mcpUrl.replace(/[/.]/g, '\\$&'))).length).toBeGreaterThanOrEqual(3)

    // Khóa thô không lọt vào bộ nhớ đệm query
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(TOKEN)

    await userEvent.click(screen.getByRole('button', { name: 'Tôi đã chép khóa' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    // Đóng → mở lại: nội dung dựng mới, không còn khóa cũ
    view.rerender(
      <QueryClientProvider client={client}>
        <McpKeyCreateDialog {...({ open: false, onOpenChange, config: {} } as unknown as CrudFormDialogProps<McpKeyDetail>)} />
      </QueryClientProvider>,
    )
    view.rerender(
      <QueryClientProvider client={client}>
        <McpKeyCreateDialog {...({ open: true, onOpenChange, config: {} } as unknown as CrudFormDialogProps<McpKeyDetail>)} />
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId('mcp-key-token')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Tên khóa')).toHaveValue('')
  })

  it('offers only the read level and hides the confidential checkbox for staff', async () => {
    renderDialog(STAFF)
    await screen.findByLabelText('Tên khóa')
    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('combobox', { name: 'Mức quyền' }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Chỉ đọc'])
    expect(screen.queryByLabelText(/Cho đọc nhóm Mật/)).not.toBeInTheDocument()
  })

  it('offers read+write and the confidential checkbox when the server says the user may, and sends the choice', async () => {
    apiPost.mockResolvedValue({ key: { id: 4 }, token: TOKEN })
    renderDialog(MANAGER_WITH_SECRET)

    const checkbox = await screen.findByRole('checkbox', { name: /Cho đọc nhóm Mật/ })
    await userEvent.click(checkbox)
    await userEvent.click(screen.getByRole('combobox', { name: 'Mức quyền' }))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Chỉ đọc', 'Đọc và ghi'])
    await userEvent.click(within(listbox).getByRole('option', { name: 'Đọc và ghi' }))
    await userEvent.type(screen.getByLabelText('Tên khóa'), 'Codex')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo khóa' }))

    expect(apiPost).toHaveBeenCalledWith('/api/mcp-keys', { name: 'Codex', access_level: 2, include_confidential: true, expires_in_days: 90 })
  })

  it('while the shown-once key is displayed, Escape and the X button cannot close the dialog; only the explicit button does', async () => {
    apiPost.mockResolvedValue({ key: { id: 5 }, token: TOKEN })
    const { onOpenChange } = renderDialog(STAFF)
    await userEvent.type(screen.getByLabelText('Tên khóa'), 'Codex')
    await userEvent.click(screen.getByRole('button', { name: 'Tạo khóa' }))
    expect(await screen.findByTestId('mcp-key-token')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('mcp-key-token')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close|đóng/i })).not.toBeInTheDocument()
    expect(screen.getByText(/lịch sử shell/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Tôi đã chép khóa' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('before the key exists, Escape closes the dialog as usual', async () => {
    const { onOpenChange } = renderDialog(STAFF)
    await screen.findByLabelText('Tên khóa')
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the create button disabled until a name is typed', async () => {
    renderDialog(STAFF)
    expect(await screen.findByRole('button', { name: 'Tạo khóa' })).toBeDisabled()
  })
})
