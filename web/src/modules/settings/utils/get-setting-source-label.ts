import { formatSettingDisplayValue } from './format-setting-value'
import type { SettingView } from '../types/setting'

export interface SettingSourceLabel {
  /** Chữ hiện trong `Pill` / dòng chú thích dưới ô. */
  text: string
  /** `true` khi giá trị đang đặt trên web — chỉ lúc đó mới có nút «Khôi phục mặc định». */
  isWeb: boolean
}

/**
 * Nhãn nguồn của một ô KHÔNG bí mật. Ô bí mật có dòng riêng («Đã đặt · <hint>»)
 * nên không đi qua hàm này — xem `SecretSettingField`.
 */
export function getSettingSourceLabel(
  setting: Pick<SettingView, 'source' | 'env_value' | 'default_value' | 'type'>,
): SettingSourceLabel {
  if (setting.source === 'web') return { text: 'đặt trên web', isWeb: true }
  if (setting.source === 'env') {
    return { text: `từ .env: ${formatSettingDisplayValue(setting.env_value, setting.type)}`, isWeb: false }
  }
  return { text: `mặc định: ${formatSettingDisplayValue(setting.default_value, setting.type)}`, isWeb: false }
}
