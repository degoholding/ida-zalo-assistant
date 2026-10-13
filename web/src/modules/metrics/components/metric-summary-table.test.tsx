import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { MetricSummary } from '../types/metric'
import { MetricSummaryTable } from './metric-summary-table'

const summary: MetricSummary = {
  rows: [
    { key: 'e:1', label: 'An', value: 150, previous: 100, change_pct: 50, flag_count: 1 },
    { key: 'e:2', label: 'Bình', value: 50, previous: 100, change_pct: -50, flag_count: 0 },
  ],
  previous_period: { from: '2026-10-05', to: '2026-10-11' },
  total: { value: 200, previous: 180, change_pct: 11.1, flag_count: 1 },
  single_metric: true,
  unit: 'đ',
  sources: ['BCSale'],
  last_ok_at: null,
}

function renderTable(value: MetricSummary, groupBy: 'staff' | 'date' = 'staff') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MetricSummaryTable summary={value} groupBy={groupBy} isLoading={false} isError={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MetricSummaryTable', () => {
  it('pins a TỔNG row with the total, shows signed change percentages and the source line', () => {
    renderTable(summary)
    expect(screen.getByText('TỔNG')).toBeInTheDocument()
    expect(screen.getByText('+50%')).toBeInTheDocument()
    expect(screen.getByText('-50%')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('+11,1%')).toBeInTheDocument()
    expect(screen.getByText(/Nguồn: BCSale/)).toBeInTheDocument()
  })
  it('has no TỔNG row when several metrics are mixed (summing units is meaningless)', () => {
    renderTable({ ...summary, single_metric: false })
    expect(screen.queryByText('TỔNG')).not.toBeInTheDocument()
  })
  it('hides the previous-period columns when grouping by date', () => {
    renderTable({ ...summary, rows: [{ key: '2026-10-12', label: '2026-10-12', value: 5, previous: null, change_pct: null, flag_count: 0 }] }, 'date')
    expect(screen.queryByText('Kỳ trước')).not.toBeInTheDocument()
    expect(screen.getByText('12/10/2026')).toBeInTheDocument()
  })
})
