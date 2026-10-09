import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EventTimeline, type TimelineEvent } from './event-timeline'

const event = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: 1, kind: 1, actor_name: 'Minh', via: 'zalo', note: '', created_at: '2026-10-09T01:00:00Z', ...overrides,
})

describe('EventTimeline', () => {
  it('shows the empty message when there are no events', () => {
    render(<EventTimeline events={[]} getLabel={() => ''} emptyMessage="Chưa có gì" />)
    expect(screen.getByText('Chưa có gì')).toBeInTheDocument()
  })

  it('falls back to "Khác" when the kind has no label mapped', () => {
    render(<EventTimeline events={[event({ kind: 99 })]} getLabel={() => ''} />)
    expect(screen.getByText('Khác')).toBeInTheDocument()
  })

  it('labels web / system / zalo events distinctly, and renders the note when present', () => {
    render(
      <EventTimeline
        events={[
          event({ id: 1, via: 'web', note: 'Ghi chú A' }),
          event({ id: 2, via: 'system', note: '' }),
          event({ id: 3, via: 'zalo', note: '' }),
        ]}
        getLabel={(kind) => `Việc #${kind}`}
      />,
    )
    expect(screen.getByText('Web')).toBeInTheDocument()
    expect(screen.getByText('Hệ thống')).toBeInTheDocument()
    expect(screen.getByText('Zalo')).toBeInTheDocument()
    expect(screen.getByText('Ghi chú A')).toBeInTheDocument()
  })
})
