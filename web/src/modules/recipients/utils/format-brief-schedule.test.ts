import { describe, expect, it } from 'vitest'

import { formatBriefSchedule } from './format-brief-schedule'

describe('formatBriefSchedule', () => {
  it('lists both briefs when both times are set', () => {
    expect(formatBriefSchedule('07:30', '17:30')).toBe('Sáng 07:30 · Chiều 17:30')
  })

  it('shows only the brief that is on', () => {
    expect(formatBriefSchedule('', '17:30')).toBe('Chiều 17:30')
    expect(formatBriefSchedule('07:30', null)).toBe('Sáng 07:30')
  })

  it('says «off» for empty, blank or missing times instead of an empty cell', () => {
    expect(formatBriefSchedule('', '')).toBe('Không gửi')
    expect(formatBriefSchedule('  ', undefined)).toBe('Không gửi')
  })
})
