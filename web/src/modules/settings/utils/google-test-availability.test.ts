import { describe, expect, it } from 'vitest'

import { getGoogleTestAvailability } from './google-test-availability'

describe('getGoogleTestAvailability', () => {
  it('khóa nút và nêu rõ lý do khi thiếu CẢ khóa lẫn link', () => {
    const result = getGoogleTestAvailability({ serviceAccountSet: false, spreadsheetUrlSet: false })
    expect(result).toEqual({ disabled: true, reason: 'Chưa dán khóa service account và chưa có link trang tính' })
  })

  it('khóa nút khi mới thiếu khóa service account', () => {
    const result = getGoogleTestAvailability({ serviceAccountSet: false, spreadsheetUrlSet: true })
    expect(result.disabled).toBe(true)
    expect(result.reason).toBe('Chưa dán khóa service account')
  })

  it('khóa nút khi mới thiếu link trang tính', () => {
    const result = getGoogleTestAvailability({ serviceAccountSet: true, spreadsheetUrlSet: false })
    expect(result.disabled).toBe(true)
    expect(result.reason).toBe('Chưa có link trang tính')
  })

  it('mở nút khi có đủ cả hai, không kèm lý do khóa', () => {
    const result = getGoogleTestAvailability({ serviceAccountSet: true, spreadsheetUrlSet: true })
    expect(result).toEqual({ disabled: false, reason: null })
  })
})
