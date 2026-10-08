import { describe, expect, it } from 'vitest'

import { AiKeyProvider, type AiKeyItem } from '../types/ai-key'
import { describeAiKeyUsage } from './describe-ai-key-usage'

function makeItem(overrides: Partial<AiKeyItem> = {}): AiKeyItem {
  return {
    id: 1, position: 1, provider: AiKeyProvider.Gemini, provider_label: 'Gemini', base_url: '', model: '', model_heavy: '',
    default_model: 'gemini-3.5-flash-lite', key_tail: '…ab12', daily_cap: 0, used_today: 0, last_error: '', last_error_at: null,
    broken: false, allowed: true, verified_at: null, ...overrides,
  }
}

describe('describeAiKeyUsage', () => {
  it('names the default model so the admin knows what the bot actually calls', () => {
    expect(describeAiKeyUsage(makeItem())).toBe('Mô hình: mặc định (gemini-3.5-flash-lite) · Trần: không giới hạn · Hôm nay 0 lượt')
  })

  it('shows the station, heavy model, cap and usage of a custom OpenAI-compatible key', () => {
    const item = makeItem({
      provider: AiKeyProvider.OpenAICompatible, base_url: 'https://modelapi.vn/v1', model: 'deepseek-v4.1-flash',
      model_heavy: 'deepseek-v4.1-pro', daily_cap: 1500, used_today: 1234,
    })
    expect(describeAiKeyUsage(item)).toBe(
      'Trạm: https://modelapi.vn/v1 · Mô hình: deepseek-v4.1-flash (việc nặng: deepseek-v4.1-pro) · Trần: 1.500 lượt/ngày · Hôm nay 1.234 lượt',
    )
  })

  it('hides a heavy model equal to the main model and treats a negative cap as no cap', () => {
    const text = describeAiKeyUsage(makeItem({ model: 'gpt-6-luna', model_heavy: 'gpt-6-luna', daily_cap: -3 }))
    expect(text).toBe('Mô hình: gpt-6-luna · Trần: không giới hạn · Hôm nay 0 lượt')
  })

  it('still reads when the server sends no default model', () => {
    expect(describeAiKeyUsage(makeItem({ default_model: '' }))).toContain('Mô hình: mặc định ·')
  })
})
