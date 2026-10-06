import { KeyRound } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { groupSettingsIntoSections } from './group-settings-into-sections'
import type { SettingView } from '../types/setting'

const setting = (key: string): SettingView => ({
  key, group: 'assistant', label: key, help: '', type: 'string', secret: false, value: '', is_set: false, hint: '',
  source: 'default', env_value: null, default_value: null, min: null, max: null, max_length: null, allow_empty: true,
})

describe('groupSettingsIntoSections', () => {
  it('xếp khóa theo thứ tự khai báo, bỏ thẻ rỗng, gom khóa lạ vào «Khác»', () => {
    const sections = [
      { id: 'a', title: 'A', description: '', icon: KeyRound, keys: ['k2', 'k1'] },
      { id: 'empty', title: 'Rỗng', description: '', icon: KeyRound, keys: ['missing'] },
    ]
    const result = groupSettingsIntoSections(sections, [setting('k1'), setting('k2'), setting('new_key')])
    expect(result.map((section) => section.id)).toEqual(['a', 'other'])
    expect(result[0].settings.map((item) => item.key)).toEqual(['k2', 'k1'])
    expect(result[1].settings.map((item) => item.key)).toEqual(['new_key'])
  })
})
