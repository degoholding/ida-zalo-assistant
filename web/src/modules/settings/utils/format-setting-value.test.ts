import { describe, expect, it } from 'vitest'

import { formatSettingDisplayValue } from './format-setting-value'

describe('formatSettingDisplayValue', () => {
  it('giá trị null hiện "(trống)" dù kiểu gì', () => {
    expect(formatSettingDisplayValue(null, 'string')).toBe('(trống)')
    expect(formatSettingDisplayValue(null, 'int')).toBe('(trống)')
  })

  it('bật/tắt đọc ra chữ thay vì true/false', () => {
    expect(formatSettingDisplayValue(true, 'bool')).toBe('bật')
    expect(formatSettingDisplayValue(false, 'bool')).toBe('tắt')
  })

  it('danh sách nối bằng dấu phẩy, rỗng thì hiện "(trống)"', () => {
    expect(formatSettingDisplayValue(['a', 'b'], 'list')).toBe('a, b')
    expect(formatSettingDisplayValue([], 'list')).toBe('(trống)')
  })

  it('chuỗi rỗng hiện "(trống)", số 0 vẫn hiện "0" (0 không phải rỗng)', () => {
    expect(formatSettingDisplayValue('', 'string')).toBe('(trống)')
    expect(formatSettingDisplayValue(0, 'int')).toBe('0')
  })

  it('số và chuỗi thường chuyển thẳng sang String()', () => {
    expect(formatSettingDisplayValue(30, 'int')).toBe('30')
    expect(formatSettingDisplayValue('gemini-3.5-flash', 'string')).toBe('gemini-3.5-flash')
  })
})
