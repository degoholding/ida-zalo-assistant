import { describe, expect, it } from 'vitest'

import { failureRate, formatCount, formatDurationMs } from './format-usage-number'

describe('format-usage-number', () => {
  it('groups thousands Vietnamese style and never prints NaN', () => {
    expect(formatCount(1234567)).toBe('1.234.567')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(Number.NaN)).toBe('0')
  })

  it('shows ms under one second and seconds above, zero / negative / NaN as 0 ms', () => {
    expect(formatDurationMs(999.6)).toBe('1000 ms')
    expect(formatDurationMs(1500)).toBe('1,5 giây')
    expect(formatDurationMs(0)).toBe('0 ms')
    expect(formatDurationMs(-3)).toBe('0 ms')
    expect(formatDurationMs(Number.NaN)).toBe('0 ms')
  })

  it('counts system errors, rejections and rate limits as failures; no calls means 0%', () => {
    expect(failureRate({ calls: 0, errors: 5, rejected: 0, rate_limited: 0 })).toBe('0%')
    expect(failureRate({ calls: 3, errors: 1, rejected: 0, rate_limited: 0 })).toBe('33,3%')
    expect(failureRate({ calls: 4, errors: 1, rejected: 1, rate_limited: 2 })).toBe('100%')
  })
})
