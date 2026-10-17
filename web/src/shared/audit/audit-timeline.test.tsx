import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditTimeline } from './audit-timeline'

const apiGet = vi.fn()
let canAudit = true

vi.mock('@/core/api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }))
vi.mock('@/core/authorization/use-permission', () => ({
  usePermission: () => ({ can: (entity: string) => entity === 'audit' && canAudit }),
}))

function renderTimeline() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuditTimeline entity="group" entityId={5} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  canAudit = true
})

describe('AuditTimeline', () => {
  it('renders nothing and never calls the API without audit.read', () => {
    canAudit = false
    const { container } = renderTimeline()
    expect(container).toBeEmptyDOMElement()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('says «no permission» on 403 instead of «Chưa có thao tác nào»', async () => {
    apiGet.mockRejectedValue({ response: { status: 403 } })
    renderTimeline()
    expect(await screen.findByText('Bạn không có quyền xem lịch sử thao tác.')).toBeInTheDocument()
    expect(screen.queryByText('Chưa có thao tác nào.')).toBeNull()
  })

  it('says the record is out of scope on 404', async () => {
    apiGet.mockRejectedValue({ response: { status: 404 } })
    renderTimeline()
    expect(await screen.findByText(/nằm ngoài phạm vi nhóm/)).toBeInTheDocument()
  })

  it('still shows the empty state when the server really returns no rows', async () => {
    apiGet.mockResolvedValue([])
    renderTimeline()
    expect(await screen.findByText('Chưa có thao tác nào.')).toBeInTheDocument()
  })
})
