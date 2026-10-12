import { describe, expect, it } from 'vitest'

import {
  formatSendCommandCode,
  getReminderRepeatLabel,
  getSendActionKindLabel,
  getSendCommandSourceLabel,
  SEND_ACTION_KIND,
  getSendTargetKindLabel,
  getSendTargetStatusLabel,
  SEND_COMMAND_SOURCE,
  SEND_COMMAND_STATUS,
  SEND_COMMAND_STATUS_OPTIONS,
  SEND_TARGET_KIND,
  SEND_TARGET_STATUS,
} from './send-command'

describe('send command code mapping', () => {
  it('mirrors the server enums in src/constants.ts', () => {
    // Chép tay — lệch một số là lọc «Đang hẹn» ra «Đang gửi»
    expect(SEND_COMMAND_SOURCE).toEqual({ zalo: 1, web: 2 })
    expect(SEND_COMMAND_STATUS).toEqual({ draft: 1, scheduled: 2, sending: 3, done: 4, cancelled: 5, expired: 6 })
    expect(SEND_ACTION_KIND).toEqual({ message: 1, reminder: 2 })
    expect(SEND_TARGET_KIND).toEqual({ group: 1, person: 2 })
    expect(SEND_TARGET_STATUS).toEqual({ pending: 1, queued: 2, sent: 3, failed: 4, cancelled: 5 })
  })

  it('has one filter option per stored status with no repeats', () => {
    const values = SEND_COMMAND_STATUS_OPTIONS.map((option) => option.value)
    expect(values).toEqual(Object.values(SEND_COMMAND_STATUS))
    expect(new Set(values).size).toBe(values.length)
  })

  it('falls back to an empty label for codes the UI does not know', () => {
    for (const code of [0, -1, 7, 99, Number.NaN]) {
      expect(getSendCommandSourceLabel(code)).toBe('')
      expect(getSendActionKindLabel(code)).toBe('')
      expect(getSendTargetKindLabel(code)).toBe('')
      expect(getSendTargetStatusLabel(code)).toBe('')
    }
  })

  it('labels the reminder repeat codes Zalo uses and leaves unknown codes empty', () => {
    for (const code of [-1, 4, 99, Number.NaN]) expect(getReminderRepeatLabel(code)).toBe('')
    expect([0, 1, 2, 3].map(getReminderRepeatLabel)).toEqual(['Không lặp', 'Hằng ngày', 'Hằng tuần', 'Hằng tháng'])
  })

  it('formats the display code like the server (G-<id>)', () => {
    expect(formatSendCommandCode(12)).toBe('G-12')
  })
})
