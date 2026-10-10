import { describe, expect, it } from 'vitest'

import {
  BRIEF_KIND,
  BRIEF_KIND_OPTIONS,
  BRIEF_STATUS,
  BRIEF_STATUS_OPTIONS,
  BRIEF_TRIGGER,
  getBriefKindLabel,
  getBriefTriggerLabel,
  isBriefReportKind,
} from './brief'

describe('brief kind mapping', () => {
  it('mirrors the server BriefKind codes 1..4 with the Vietnamese labels', () => {
    // Chép tay từ `src/constants.ts` — lệch một số là lọc «Bản tin sáng» ra «Báo cáo tuần»
    expect(BRIEF_KIND).toEqual({ morning: 1, evening: 2, weekly: 3, monthly: 4 })
    expect(BRIEF_KIND_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      [1, 'Bản tin sáng'],
      [2, 'Bản tin cuối ngày'],
      [3, 'Báo cáo tuần'],
      [4, 'Báo cáo tháng'],
    ])
  })

  it('falls back to an empty label for codes the UI does not know', () => {
    for (const code of [0, -1, 5, 99, Number.NaN]) expect(getBriefKindLabel(code)).toBe('')
  })

  it('only treats Weekly / Monthly as report kinds that carry PDF + Excel files', () => {
    expect([BRIEF_KIND.morning, BRIEF_KIND.evening, BRIEF_KIND.weekly, BRIEF_KIND.monthly, 0, 99].filter(isBriefReportKind)).toEqual([
      BRIEF_KIND.weekly,
      BRIEF_KIND.monthly,
    ])
  })
})

describe('brief trigger / status mapping', () => {
  it('mirrors BriefTrigger 1..3', () => {
    expect(BRIEF_TRIGGER).toEqual({ schedule: 1, chat: 2, webTest: 3 })
    expect(getBriefTriggerLabel(BRIEF_TRIGGER.webTest)).toBe('Gửi thử (web)')
    expect(getBriefTriggerLabel(99)).toBe('')
  })

  it('mirrors BriefStatus 1..4', () => {
    expect(BRIEF_STATUS).toEqual({ composing: 1, queued: 2, sent: 3, failed: 4 })
    expect(BRIEF_STATUS_OPTIONS.map((option) => option.value)).toEqual([1, 2, 3, 4])
  })
})
