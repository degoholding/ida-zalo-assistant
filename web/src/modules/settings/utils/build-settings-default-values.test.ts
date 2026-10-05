import { describe, expect, it } from 'vitest'

import { buildSettingsDefaultValues, toSettingFieldValue } from './build-settings-default-values'
import type { SettingView } from '../types/setting'

function makeSetting(overrides: Partial<SettingView>): SettingView {
  return {
    key: 'gemini_model', group: 'assistant', label: 'Mô hình chính', help: '', type: 'string', secret: false,
    value: 'gemini-3.5-flash-lite', is_set: true, hint: '', source: 'default', env_value: null,
    default_value: 'gemini-3.5-flash-lite', min: null, max: null, max_length: null, allow_empty: false,
    ...overrides,
  }
}

describe('toSettingFieldValue', () => {
  it('ô bí mật LUÔN trả rỗng, kể cả khi is_set true (máy chủ không bao giờ trả giá trị thật)', () => {
    expect(toSettingFieldValue(makeSetting({ secret: true, type: 'string', value: null, is_set: true }))).toBe('')
  })

  it('bool: null coi như tắt (false), không ném lỗi', () => {
    expect(toSettingFieldValue(makeSetting({ type: 'bool', value: null }))).toBe(false)
    expect(toSettingFieldValue(makeSetting({ type: 'bool', value: true }))).toBe(true)
  })

  it('int: không phải số (null) thì về 0 thay vì NaN — ô nhập không được hiện NaN', () => {
    expect(toSettingFieldValue(makeSetting({ type: 'int', value: null }))).toBe(0)
    expect(toSettingFieldValue(makeSetting({ type: 'int', value: 42 }))).toBe(42)
  })

  it('list: mảng nối bằng ", ", mảng rỗng thành chuỗi rỗng', () => {
    expect(toSettingFieldValue(makeSetting({ type: 'list', value: ['a', 'b'] }))).toBe('a, b')
    expect(toSettingFieldValue(makeSetting({ type: 'list', value: [] }))).toBe('')
  })

  it('string: null hoặc không phải chuỗi thì về rỗng', () => {
    expect(toSettingFieldValue(makeSetting({ type: 'string', value: null }))).toBe('')
    expect(toSettingFieldValue(makeSetting({ type: 'string', value: 'x' }))).toBe('x')
  })
})

describe('buildSettingsDefaultValues', () => {
  it('dựng đủ một khóa cho mỗi phần tử, giữ đúng thứ tự khóa truyền vào', () => {
    const settings = [
      makeSetting({ key: 'a', type: 'int', value: 10 }),
      makeSetting({ key: 'b', type: 'bool', value: true }),
    ]
    expect(buildSettingsDefaultValues(settings)).toEqual({ a: 10, b: true })
  })

  it('danh sách rỗng trả object rỗng, không ném lỗi', () => {
    expect(buildSettingsDefaultValues([])).toEqual({})
  })
})
