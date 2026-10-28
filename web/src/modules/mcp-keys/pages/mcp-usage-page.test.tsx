import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpUsage } from '../types/mcp-usage'
import { McpUsagePage } from './mcp-usage-page'

const apiGet = vi.fn()
let permissions: Record<string, Record<string, boolean>> = {}

vi.mock('@/core/api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args), apiPost: vi.fn(), httpClient: { post: vi.fn() } }))
vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { permissions: Record<string, Record<string, boolean>> } }) => unknown) => selector({ user: { permissions } }),
}))

const counts = { calls: 0, ok: 0, errors: 0, rejected: 0, rate_limited: 0, avg_ms: 0, p95_ms: 0, rows: 0, chars: 0, est_tokens: 0 }
const usage: McpUsage = {
  since: '2026-10-21T17:00:00.000Z',
  days: 7,
  group_by: 'key',
  totals: { ...counts, calls: 12, ok: 10, errors: 1, rejected: 1, avg_ms: 250, p95_ms: 1800, rows: 340, chars: 40000, est_tokens: 10000 },
  daily: [
    { ...counts, day: '2026-10-28', subject_id: 5, subject_name: 'Claude máy sếp (ab12cd34)', owner_name: 'Sếp IDA', calls: 12, errors: 1, rejected: 1, rows: 340, est_tokens: 10000, avg_ms: 250, p95_ms: 1800 },
  ],
  truncated: false,
  top_tools: [{ ...counts, tool: 'activity_summary', calls: 7 }, { ...counts, tool: 'export_report', calls: 5 }],
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <McpUsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('McpUsagePage', () => {
  it('does not call the stats API for non-admins and says only admins can see it', () => {
    permissions = { mcp_key: { read: true, write: true } }
    renderPage()
    expect(screen.getByText('Chỉ quản trị xem được thống kê này.')).toBeInTheDocument()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('shows totals, the per-day row with key owner, and the most used tools for admins', async () => {
    permissions = { setting: { read: true, write: true }, mcp_key: { read: true, write: true } }
    apiGet.mockResolvedValue(usage)
    renderPage()
    expect(await screen.findByText('Claude máy sếp (ab12cd34)')).toBeInTheDocument()
    expect(apiGet).toHaveBeenCalledWith('/api/mcp-usage', { params: { days: 7, group: 'key', source: 'http' } })
    expect(screen.getByText('Sếp IDA')).toBeInTheDocument()
    expect(screen.getByText('1,8 giây')).toBeInTheDocument()
    expect(screen.getByText('Lỗi / bị chặn: 16,7%')).toBeInTheDocument()
    const tools = screen.getByText('Công cụ dùng nhiều nhất').closest('div') as HTMLElement
    expect(within(tools).getByText('activity_summary')).toBeInTheDocument()
    expect(within(tools).getByText('export_report')).toBeInTheDocument()
  })

  it('shows the empty message instead of an empty table when there were no calls', async () => {
    permissions = { setting: { read: true, write: true } }
    apiGet.mockResolvedValue({ ...usage, totals: counts, daily: [], top_tools: [] })
    renderPage()
    expect(await screen.findAllByText('Chưa có lượt gọi nào trong khoảng này.')).toHaveLength(2)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
