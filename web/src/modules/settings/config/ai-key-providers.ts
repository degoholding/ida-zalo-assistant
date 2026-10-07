import { AiKeyProvider } from '../types/ai-key'

/** Câu mở đầu thẻ Khóa AI — giống câu của thẻ Khóa AI bên ERP. */
export const AI_KEY_INTRO = 'Bot dùng khóa số 1; khóa đó hết tiền, hết hạn mức hay sai thì tự chuyển sang số 2, số 3…'

export interface AiKeyProviderOption {
  value: AiKeyProvider
  label: string
  /** Trang lấy khóa của hãng; rỗng = hãng tùy chỉnh (nhập địa chỉ trạm thay vì «Mở trang»). */
  site: string
  /** Gợi ý tên mô hình hay dùng — chỉ gợi ý, gõ tên khác vẫn được. */
  models: string[]
}

/**
 * Thứ tự hiện trong ô «1. Hãng». Nhãn khớp `AI_PROVIDERS` ở `src/assistant/ai-key-providers.ts`. Claude chưa có: máy chủ
 * bot chưa có client gọi Anthropic.
 */
export const AI_KEY_PROVIDER_OPTIONS: AiKeyProviderOption[] = [
  {
    value: AiKeyProvider.Gemini,
    label: 'Gemini',
    site: 'https://aistudio.google.com/apikey',
    models: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'],
  },
  {
    value: AiKeyProvider.OpenAI,
    label: 'OpenAI',
    site: 'https://platform.openai.com/api-keys',
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
  },
  {
    value: AiKeyProvider.DeepSeek,
    label: 'DeepSeek',
    site: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  { value: AiKeyProvider.Xai, label: 'Grok (xAI)', site: 'https://console.x.ai', models: ['grok-4-fast', 'grok-4', 'grok-3-mini'] },
  {
    value: AiKeyProvider.OpenRouter,
    label: 'OpenRouter',
    site: 'https://openrouter.ai/keys',
    models: ['openrouter/auto', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
  },
  { value: AiKeyProvider.OpenAICompatible, label: 'Tương thích OpenAI (tùy chỉnh)', site: '', models: ['deepseek-v4.1-flash'] },
]

export function findAiKeyProviderOption(provider: AiKeyProvider): AiKeyProviderOption | undefined {
  return AI_KEY_PROVIDER_OPTIONS.find((option) => option.value === provider)
}
