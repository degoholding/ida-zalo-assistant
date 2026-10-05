import { describe, expect, it } from 'vitest'

import { buildSettingsSchema } from './build-settings-schema'
import type { SettingView } from '../types/setting'

function makeSetting(overrides: Partial<SettingView>): SettingView {
  return {
    key: 'f', group: 'assistant', label: 'Trường', help: '', type: 'string', secret: false,
    value: '', is_set: false, hint: '', source: 'default', env_value: null, default_value: null,
    min: null, max: null, max_length: null, allow_empty: false,
    ...overrides,
  }
}

describe('buildSettingsSchema — int', () => {
  it('nhận số nguyên trong khoảng, kể cả dạng chuỗi "30"', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'int', min: 1, max: 1000 })])
    expect(schema.safeParse({ f: '30' }).success).toBe(true)
    expect(schema.safeParse({ f: 30 }).success).toBe(true)
  })

  it('từ chối số thực, chuỗi chữ, ngoài khoảng, âm và 0 dưới trần min', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'int', min: 1, max: 1000 })])
    expect(schema.safeParse({ f: '30.5' }).success).toBe(false)
    expect(schema.safeParse({ f: 'abc' }).success).toBe(false)
    expect(schema.safeParse({ f: 5000 }).success).toBe(false)
    expect(schema.safeParse({ f: -1 }).success).toBe(false)
    expect(schema.safeParse({ f: 0 }).success).toBe(false)
  })

  it('không có min/max khai báo thì không ràng buộc gì ngoài "là số nguyên"', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'int', min: null, max: null })])
    expect(schema.safeParse({ f: -999999 }).success).toBe(true)
  })
})

describe('buildSettingsSchema — bool', () => {
  it('chỉ nhận true/false, không nhận chuỗi "true"', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'bool' })])
    expect(schema.safeParse({ f: true }).success).toBe(true)
    expect(schema.safeParse({ f: false }).success).toBe(true)
    expect(schema.safeParse({ f: 'true' }).success).toBe(false)
  })
})

describe('buildSettingsSchema — string', () => {
  it('allow_empty=false từ chối chuỗi rỗng và chuỗi toàn khoảng trắng', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'string', allow_empty: false })])
    expect(schema.safeParse({ f: '' }).success).toBe(false)
    expect(schema.safeParse({ f: 'gemini-3.5-flash' }).success).toBe(true)
  })

  it('allow_empty=true chấp nhận chuỗi rỗng', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'string', allow_empty: true })])
    expect(schema.safeParse({ f: '' }).success).toBe(true)
  })

  it('vượt max_length thì báo lỗi', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'string', allow_empty: true, max_length: 5 })])
    expect(schema.safeParse({ f: '123456' }).success).toBe(false)
    expect(schema.safeParse({ f: '12345' }).success).toBe(true)
  })
})

describe('buildSettingsSchema — list', () => {
  it('allow_empty=false từ chối chuỗi rỗng hoặc toàn dấu phẩy', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'list', allow_empty: false })])
    expect(schema.safeParse({ f: '' }).success).toBe(false)
    expect(schema.safeParse({ f: ' , , ' }).success).toBe(false)
    expect(schema.safeParse({ f: 'gemini-3.5-flash' }).success).toBe(true)
  })

  it('allow_empty=true chấp nhận rỗng', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'list', allow_empty: true })])
    expect(schema.safeParse({ f: '' }).success).toBe(true)
  })

  it('vượt số mục tối đa (max) thì báo lỗi — gemini_fallback_models tối đa 5', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'list', allow_empty: true, max: 5 })])
    expect(schema.safeParse({ f: 'a,b,c,d,e' }).success).toBe(true)
    expect(schema.safeParse({ f: 'a,b,c,d,e,f' }).success).toBe(false)
  })

  it('đếm mục bỏ qua khoảng trắng thừa và phần tử rỗng giữa hai dấu phẩy', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'list', allow_empty: false, max: 2 })])
    expect(schema.safeParse({ f: ' a , , b ' }).success).toBe(true)
  })
})

describe('buildSettingsSchema — ô bí mật (string/json)', () => {
  it('để trống LUÔN hợp lệ — trống nghĩa là "giữ nguyên", không phải "xóa"', () => {
    const schema = buildSettingsSchema([
      makeSetting({ key: 'f', type: 'string', secret: true, allow_empty: false, max_length: 200 }),
    ])
    expect(schema.safeParse({ f: '' }).success).toBe(true)
  })

  it('có gõ thì vẫn kiểm max_length', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'string', secret: true, max_length: 5 })])
    expect(schema.safeParse({ f: '123456' }).success).toBe(false)
    expect(schema.safeParse({ f: '12345' }).success).toBe(true)
  })

  it('json bí mật (khóa service account) để trống vẫn hợp lệ dù không allow_empty', () => {
    const schema = buildSettingsSchema([makeSetting({ key: 'f', type: 'json', secret: true, allow_empty: false })])
    expect(schema.safeParse({ f: '' }).success).toBe(true)
    expect(schema.safeParse({ f: '{"type":"service_account"}' }).success).toBe(true)
  })
})

describe('buildSettingsSchema — nhiều khóa cùng lúc', () => {
  it('dựng đủ ràng buộc cho từng khóa, sai một khóa thì báo đúng khóa đó', () => {
    const schema = buildSettingsSchema([
      makeSetting({ key: 'assistant_max_per_hour', type: 'int', min: 1, max: 1000 }),
      makeSetting({ key: 'gemini_model', type: 'string', allow_empty: false }),
    ])
    const result = schema.safeParse({ assistant_max_per_hour: 5000, gemini_model: 'gemini-3.5-flash-lite' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['assistant_max_per_hour'])
  })
})
