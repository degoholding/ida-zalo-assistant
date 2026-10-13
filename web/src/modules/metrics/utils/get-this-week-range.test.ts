import { describe, expect, it } from 'vitest'

import { getThisWeekRange } from './get-this-week-range'

describe('getThisWeekRange', () => {
  it('starts on Monday and ends today', () => {
    // 12/10/2026 là thứ Hai
    expect(getThisWeekRange(new Date(2026, 9, 12))).toEqual({ from: '2026-10-12', to: '2026-10-12' })
    // 15/10/2026 là thứ Năm
    expect(getThisWeekRange(new Date(2026, 9, 15))).toEqual({ from: '2026-10-12', to: '2026-10-15' })
  })
  it('treats Sunday as the last day of the week and crosses month boundaries', () => {
    expect(getThisWeekRange(new Date(2026, 9, 18))).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(getThisWeekRange(new Date(2026, 10, 1))).toEqual({ from: '2026-10-26', to: '2026-11-01' })
  })
})
