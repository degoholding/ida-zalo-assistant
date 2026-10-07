import { describe, expect, it } from 'vitest'

import { formatAiKeyLastError } from './format-ai-key-last-error'

// 07/10/2026 15:00 giờ Việt Nam
const NOW = new Date('2026-10-07T08:00:00Z')

describe('formatAiKeyLastError', () => {
  it('shows only the Vietnam time when the error happened today', () => {
    expect(formatAiKeyLastError({ last_error: 'hết tiền (402)', last_error_at: '2026-10-07T07:05:00Z' }, NOW)).toBe(
      'Lỗi lúc 14:05: hết tiền (402)',
    )
  })

  it('adds the day when the error is from another Vietnam day, even if UTC says the same date', () => {
    // 06/10 23:30 giờ Việt Nam = 06/10 16:30 UTC; còn 07/10 00:30 giờ VN = 06/10 17:30 UTC nhưng đã là hôm nay
    expect(formatAiKeyLastError({ last_error: 'hết hạn mức (429)', last_error_at: '2026-10-06T16:30:00Z' }, NOW)).toBe(
      'Lỗi lúc 23:30 06/10: hết hạn mức (429)',
    )
    expect(formatAiKeyLastError({ last_error: 'quá thời gian', last_error_at: '2026-10-06T17:30:00Z' }, NOW)).toBe(
      'Lỗi lúc 00:30: quá thời gian',
    )
  })

  it('is empty when there was never an error or the date is garbage', () => {
    expect(formatAiKeyLastError({ last_error: '', last_error_at: null }, NOW)).toBe('')
    expect(formatAiKeyLastError({ last_error: 'hết tiền', last_error_at: null }, NOW)).toBe('')
    expect(formatAiKeyLastError({ last_error: '', last_error_at: '2026-10-07T07:05:00Z' }, NOW)).toBe('')
    expect(formatAiKeyLastError({ last_error: 'hết tiền', last_error_at: 'không-phải-ngày' }, NOW)).toBe('')
  })
})
