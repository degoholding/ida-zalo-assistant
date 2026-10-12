import { describe, expect, it } from 'vitest'

import { formatHaltSince } from './format-halt-since'

describe('formatHaltSince', () => {
  it('shows hh:mm dd/mm in Vietnam time regardless of the machine zone', () => {
    // 07:30 UTC = 14:30 giờ Việt Nam
    expect(formatHaltSince('2026-10-12T07:30:00.000Z')).toBe('14:30 12/10')
  })

  it('rolls over to the next Vietnam day after 17:00 UTC', () => {
    expect(formatHaltSince('2026-10-12T17:05:00.000Z')).toBe('00:05 13/10')
  })

  it('returns an empty string for empty, null or unreadable input instead of throwing', () => {
    for (const value of [null, undefined, '', 'rác', '0000-00-00']) expect(formatHaltSince(value)).toBe('')
  })
})
