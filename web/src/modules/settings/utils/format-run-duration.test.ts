import { describe, expect, it } from 'vitest'

import { formatRunDuration } from './format-run-duration'

describe('formatRunDuration', () => {
  it('keeps sub-second runs in milliseconds, including a zero-length run', () => {
    expect(formatRunDuration(0)).toBe('0 ms')
    expect(formatRunDuration(350)).toBe('350 ms')
    expect(formatRunDuration(999.6)).toBe('1000 ms')
  })

  it('shows seconds with a Vietnamese decimal comma under one minute', () => {
    expect(formatRunDuration(1000)).toBe('1 giây')
    expect(formatRunDuration(4200)).toBe('4,2 giây')
  })

  it('switches to minutes and hours, dropping a zero remainder', () => {
    expect(formatRunDuration(60_000)).toBe('1 phút')
    expect(formatRunDuration(185_000)).toBe('3 phút 5 giây')
    expect(formatRunDuration(3_600_000)).toBe('1 giờ')
    expect(formatRunDuration(3_720_000)).toBe('1 giờ 2 phút')
  })

  it('returns an empty string for negative or non-numeric durations instead of a nonsense value', () => {
    expect(formatRunDuration(-5)).toBe('')
    expect(formatRunDuration(Number.NaN)).toBe('')
    expect(formatRunDuration(Number.POSITIVE_INFINITY)).toBe('')
  })
})
