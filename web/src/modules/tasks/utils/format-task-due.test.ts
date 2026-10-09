import { describe, expect, it } from 'vitest'

import { formatTaskDue } from './format-task-due'

describe('formatTaskDue', () => {
  it('says there is no due date when due_at is null, whatever due_has_time says', () => {
    expect(formatTaskDue(null, false)).toBe('Chưa có hạn')
    expect(formatTaskDue(null, true)).toBe('Chưa có hạn')
  })

  it('shows only the date when the due date has no time component', () => {
    //  00:00 giờ VN ngày 19/10/2026 lưu dưới UTC là 17:00 ngày 18/10 — đúng luật «hạn chỉ ngày» của máy chủ
    expect(formatTaskDue('2026-10-18T17:00:00.000Z', false)).toBe('19/10/2026')
  })

  it('shows date and time when the due date has a time component', () => {
    expect(formatTaskDue('2026-10-18T10:30:00.000Z', true)).toBe('18/10/2026 17:30')
  })
})
