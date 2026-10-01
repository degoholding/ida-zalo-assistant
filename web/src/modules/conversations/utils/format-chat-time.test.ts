import { describe, expect, it } from 'vitest'

import { buildTimelineRows, formatDayLabel, formatShortTime, isSameRun } from './format-chat-time'

const NOW = new Date('2026-10-01T10:00:00+07:00')

describe('format-chat-time', () => {
  it('labels today, yesterday, same-year and other-year days differently', () => {
    expect(formatDayLabel('2026-10-01T01:00:00+07:00', NOW)).toBe('Hôm nay')
    expect(formatDayLabel('2026-09-30T23:59:00+07:00', NOW)).toBe('Hôm qua')
    expect(formatDayLabel('2026-03-05T08:00:00+07:00', NOW)).toBe('05/03')
    expect(formatDayLabel('2025-03-05T08:00:00+07:00', NOW)).toBe('05/03/2025')
  })

  it('shortens list times: clock today, day/month this year, dd/mm/yy otherwise, blank when missing', () => {
    expect(formatShortTime('2026-10-01T09:05:00+07:00', NOW)).toBe('09:05')
    expect(formatShortTime('2026-09-30T09:05:00+07:00', NOW)).toBe('30/09')
    expect(formatShortTime('2025-09-30T09:05:00+07:00', NOW)).toBe('30/09/25')
    expect(formatShortTime(null, NOW)).toBe('')
  })

  it('groups messages into a run only when same sender, same day and under 5 minutes apart', () => {
    const first = { sender_uid: 'a', sent_at: '2026-10-01T09:00:00+07:00' }
    expect(isSameRun(null, first)).toBe(false)
    expect(isSameRun(first, { sender_uid: 'a', sent_at: '2026-10-01T09:04:59+07:00' })).toBe(true)
    expect(isSameRun(first, { sender_uid: 'a', sent_at: '2026-10-01T09:05:00+07:00' })).toBe(false)
    expect(isSameRun(first, { sender_uid: 'b', sent_at: '2026-10-01T09:00:10+07:00' })).toBe(false)
    // Qua nửa đêm thì ngăn ngày mới, không gộp dù chỉ cách một phút
    expect(isSameRun({ sender_uid: 'a', sent_at: '2026-10-01T23:59:30+07:00' }, { sender_uid: 'a', sent_at: '2026-10-02T00:00:10+07:00' })).toBe(false)
  })

  it('marks day breaks and run edges so names show once and avatars sit on the last bubble', () => {
    const rows = buildTimelineRows([
      { id: 1, sender_uid: 'a', sent_at: '2026-10-01T09:00:00+07:00' },
      { id: 2, sender_uid: 'a', sent_at: '2026-10-01T09:01:00+07:00' },
      { id: 3, sender_uid: 'b', sent_at: '2026-10-01T09:02:00+07:00' },
      { id: 4, sender_uid: 'b', sent_at: '2026-10-02T09:02:00+07:00' },
    ])
    expect(rows.map((row) => [row.newDay, row.firstOfRun, row.lastOfRun])).toEqual([
      [true, true, false],
      [false, false, true],
      [false, true, true],
      [true, true, true],
    ])
    expect(buildTimelineRows([])).toEqual([])
  })
})
