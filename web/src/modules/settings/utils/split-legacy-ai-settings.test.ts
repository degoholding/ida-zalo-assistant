import { describe, expect, it } from 'vitest'

import { ASSISTANT_SECTIONS } from '../config/settings-sections'
import type { SettingView } from '../types/setting'
import { LEGACY_AI_SETTING_KEYS, splitLegacyAiSettings } from './split-legacy-ai-settings'

function makeSetting(key: string): SettingView {
  return {
    key, group: 'assistant', label: key, help: '', type: 'string', secret: false, value: '', is_set: false, hint: '',
    source: 'default', env_value: null, default_value: '', min: null, max: null, max_length: null, allow_empty: true,
  }
}

describe('splitLegacyAiSettings', () => {
  it('moves only the old provider / key / model fields aside, keeping order and unknown keys', () => {
    const settings = ['assistant_max_per_hour', 'ai_provider', 'gemini_api_key', 'new_server_key', 'openai_model'].map(makeSetting)
    const { current, legacy } = splitLegacyAiSettings(settings)
    expect(current.map((item) => item.key)).toEqual(['assistant_max_per_hour', 'new_server_key'])
    expect(legacy.map((item) => item.key)).toEqual(['ai_provider', 'gemini_api_key', 'openai_model'])
  })

  it('handles an empty list', () => {
    expect(splitLegacyAiSettings([])).toEqual({ current: [], legacy: [] })
  })

  it('covers exactly the keys of the three old AI cards, so nothing old is left in the main form', () => {
    const oldCards = ASSISTANT_SECTIONS.filter((section) => ['ai-provider', 'openai-models', 'gemini-models'].includes(section.id))
    expect(oldCards.flatMap((section) => section.keys).sort()).toEqual([...LEGACY_AI_SETTING_KEYS].sort())
  })
})
