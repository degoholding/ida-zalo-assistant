import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ScheduleRunStatus, type ScheduleStatus } from '../types/schedule'
import { ScheduleStatusCard } from './schedule-status-card'

const apiGet = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
}))

function makeSchedule(overrides: Partial<ScheduleStatus>): ScheduleStatus {
  return {
    name: 'backup',
    label: 'Sao lưu CSDL',
    schedule: 'hằng ngày 02:00',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: ScheduleRunStatus.NeverRun,
    lastError: '',
    lastDurationMs: 0,
    ...overrides,
  }
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ScheduleStatusCard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScheduleStatusCard', () => {
  it('loads from /api/schedules and shows each job with its schedule, Vietnam-time last run, status and duration', async () => {
    apiGet.mockResolvedValue([
      makeSchedule({
        lastStartedAt: '2026-10-07T19:00:00.000Z',
        lastFinishedAt: '2026-10-07T19:00:04.200Z',
        lastStatus: ScheduleRunStatus.Done,
        lastDurationMs: 4200,
      }),
    ])
    renderCard()

    const row = (await screen.findByText('Sao lưu CSDL')).closest('li')
    expect(row).not.toBeNull()
    if (!row) return
    expect(apiGet).toHaveBeenCalledWith('/api/schedules')
    expect(within(row).getByText('Xong')).toBeInTheDocument()
    // 19:00 UTC = 02:00 sáng hôm sau giờ Việt Nam
    expect(within(row).getByText('Lịch: hằng ngày 02:00 · lần gần nhất 08/10/2026 02:00 · chạy 4,2 giây')).toBeInTheDocument()
  })

  it('shows the error text only for a failed run', async () => {
    apiGet.mockResolvedValue([
      makeSchedule({
        name: 'cleanup',
        label: 'Dọn tệp gốc hết hạn',
        lastStartedAt: '2026-10-07T20:00:00.000Z',
        lastFinishedAt: '2026-10-07T20:00:01.000Z',
        lastStatus: ScheduleRunStatus.Failed,
        lastError: 'R2 từ chối (403)',
        lastDurationMs: 1000,
      }),
      makeSchedule({
        // Lỗi cũ còn sót trong cột nhưng lượt mới đã xong — không được hiện lại
        lastStartedAt: '2026-10-07T19:00:00.000Z',
        lastFinishedAt: '2026-10-07T19:00:01.000Z',
        lastStatus: ScheduleRunStatus.Done,
        lastError: 'lỗi của lượt trước',
        lastDurationMs: 1000,
      }),
    ])
    renderCard()

    const failed = (await screen.findByText('Dọn tệp gốc hết hạn')).closest('li')
    expect(failed).not.toBeNull()
    if (!failed) return
    expect(within(failed).getByText('Lỗi')).toBeInTheDocument()
    expect(within(failed).getByText('R2 từ chối (403)')).toBeInTheDocument()
    expect(screen.queryByText('lỗi của lượt trước')).toBeNull()
  })

  it('says "never run" for a job without history and hides the stale duration while a job is running', async () => {
    apiGet.mockResolvedValue([
      makeSchedule({ name: 'digest', label: 'Bản tin sáng', schedule: 'hằng ngày 07:30 (ngày làm việc)' }),
      makeSchedule({
        lastStartedAt: '2026-10-07T19:00:00.000Z',
        lastFinishedAt: '2026-10-06T19:00:09.000Z',
        lastStatus: ScheduleRunStatus.Running,
        lastDurationMs: 9000,
      }),
    ])
    renderCard()

    const never = (await screen.findByText('Bản tin sáng')).closest('li')
    const running = screen.getByText('Sao lưu CSDL').closest('li')
    expect(never).not.toBeNull()
    expect(running).not.toBeNull()
    if (!never || !running) return
    expect(within(never).getByText('Chưa chạy')).toBeInTheDocument()
    expect(within(never).getByText('Lịch: hằng ngày 07:30 (ngày làm việc) · chưa chạy lần nào')).toBeInTheDocument()
    expect(within(running).getByText('Đang chạy')).toBeInTheDocument()
    expect(within(running).queryByText(/chạy 9 giây/)).toBeNull()
  })

  it('falls back to "Chưa chạy" for a status code the UI does not know yet', async () => {
    apiGet.mockResolvedValue([makeSchedule({ lastStatus: 9 as ScheduleRunStatus })])
    renderCard()

    const row = (await screen.findByText('Sao lưu CSDL')).closest('li')
    expect(row).not.toBeNull()
    if (!row) return
    expect(within(row).getByText('Chưa chạy')).toBeInTheDocument()
  })

  it('shows an empty message when the server has no scheduled jobs', async () => {
    apiGet.mockResolvedValue([])
    renderCard()

    expect(await screen.findByText('Chưa có việc nào chạy theo lịch.')).toBeInTheDocument()
  })
})
