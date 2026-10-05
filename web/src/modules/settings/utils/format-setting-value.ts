import type { SettingPrimitive, SettingType } from '../types/setting'

/**
 * Hiện một giá trị `.env` / mặc định dưới ô cho DỄ ĐỌC — số giữ nguyên, bật/tắt
 * đọc ra chữ, danh sách nối bằng dấu phẩy. Không dùng cho ô bí mật (luôn `null`,
 * xem `SecretSettingField` dùng `hint` riêng).
 */
export function formatSettingDisplayValue(value: SettingPrimitive, type: SettingType): string {
  if (value === null || value === undefined) return '(trống)'
  if (type === 'bool') return value ? 'bật' : 'tắt'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(trống)'
  if (value === '') return '(trống)'
  return String(value)
}
