import type { SettingView } from '../types/setting'

/**
 * Các ô AI «cách cũ» của tab Trợ lý AI (nhà cung cấp, khóa, mô hình Gemini / OpenAI). Có bảng Khóa AI thì bot bỏ qua chúng —
 * màn hình gập vào mục «Nâng cao (cách cũ)». Định nghĩa phía máy chủ giữ nguyên để `.env` đang dùng không vỡ.
 */
export const LEGACY_AI_SETTING_KEYS = [
  'ai_provider',
  'openai_api_key',
  'openai_base_url',
  'gemini_api_key',
  'openai_model',
  'openai_model_heavy',
  'openai_fallback_models',
  'gemini_model',
  'gemini_model_heavy',
  'gemini_fallback_models',
]

/** Tách các ô của tab Trợ lý AI thành phần còn dùng và phần AI cách cũ (giữ thứ tự gốc). */
export function splitLegacyAiSettings(settings: SettingView[]): { current: SettingView[]; legacy: SettingView[] } {
  const legacyKeys = new Set(LEGACY_AI_SETTING_KEYS)
  return {
    current: settings.filter((setting) => !legacyKeys.has(setting.key)),
    legacy: settings.filter((setting) => legacyKeys.has(setting.key)),
  }
}
