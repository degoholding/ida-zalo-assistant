import { describe, expect, it } from 'vitest'

import { formatChangePercent, formatMetricNumber } from './format-metric-number'

describe('formatMetricNumber', () => {
  it('formats with Vietnamese separators and at most 2 decimals', () => {
    expect(formatMetricNumber(12345.5)).toBe('12.345,5')
    expect(formatMetricNumber(1.234)).toBe('1,23')
    expect(formatMetricNumber(0)).toBe('0')
  })
  it('shows a dash for missing values', () => {
    expect(formatMetricNumber(null)).toBe('—')
    expect(formatMetricNumber(undefined)).toBe('—')
    expect(formatMetricNumber(Number.NaN)).toBe('—')
  })
})

describe('formatChangePercent', () => {
  it('signs positive changes, keeps negatives, dash when no baseline', () => {
    expect(formatChangePercent(12.5)).toBe('+12,5%')
    expect(formatChangePercent(-3)).toBe('-3%')
    expect(formatChangePercent(0)).toBe('0%')
    expect(formatChangePercent(null)).toBe('—')
  })
})
