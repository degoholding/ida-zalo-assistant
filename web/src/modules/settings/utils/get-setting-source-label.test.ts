import { describe, expect, it } from 'vitest'

import { getSettingSourceLabel } from './get-setting-source-label'

describe('getSettingSourceLabel', () => {
  it('nguồn "web" hiện đúng nhãn «đặt trên web» và cờ isWeb', () => {
    const label = getSettingSourceLabel({ source: 'web', env_value: null, default_value: 30, type: 'int' })
    expect(label).toEqual({ text: 'đặt trên web', isWeb: true })
  })

  it('nguồn "env" hiện giá trị .env, không phải mặc định', () => {
    const label = getSettingSourceLabel({ source: 'env', env_value: 40, default_value: 30, type: 'int' })
    expect(label).toEqual({ text: 'từ .env: 40', isWeb: false })
  })

  it('nguồn "default" hiện giá trị mặc định', () => {
    const label = getSettingSourceLabel({ source: 'default', env_value: null, default_value: 30, type: 'int' })
    expect(label).toEqual({ text: 'mặc định: 30', isWeb: false })
  })

  it('giá trị bool false vẫn hiện "tắt" chứ không bị coi là rỗng (false khác null)', () => {
    const label = getSettingSourceLabel({ source: 'default', env_value: null, default_value: false, type: 'bool' })
    expect(label.text).toBe('mặc định: tắt')
  })
})
