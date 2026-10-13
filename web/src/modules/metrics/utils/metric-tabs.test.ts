import { describe, expect, it } from 'vitest'

import { resolveMetricTab } from './metric-tabs'

describe('resolveMetricTab', () => {
  it('keeps known tabs and falls back to summary', () => {
    expect(resolveMetricTab('details')).toBe('details')
    expect(resolveMetricTab('missing')).toBe('missing')
    expect(resolveMetricTab('rác')).toBe('summary')
    expect(resolveMetricTab(null)).toBe('summary')
  })
})
