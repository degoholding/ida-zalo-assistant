import type { SettingFormValues, SettingView } from '../types/setting'

/**
 * Giá trị khởi tạo cho MỘT ô — ô bí mật LUÔN rỗng (máy chủ không bao giờ trả
 * giá trị bí mật, và dán lại giá trị cũ vào ô nhập là lỗi bảo mật). Danh sách
 * giữ dưới dạng chuỗi cách nhau bằng dấu phẩy để khớp ô nhập một dòng.
 */
export function toSettingFieldValue(setting: SettingView): string | number | boolean {
  if (setting.secret) return ''
  if (setting.type === 'bool') return Boolean(setting.value)
  if (setting.type === 'int') return typeof setting.value === 'number' ? setting.value : 0
  if (Array.isArray(setting.value)) return setting.value.join(', ')
  return typeof setting.value === 'string' ? setting.value : ''
}

/** Giá trị khởi tạo cho form của một tab — dựng từ danh sách `SettingView` của đúng nhóm đó. */
export function buildSettingsDefaultValues(settings: SettingView[]): SettingFormValues {
  const values: SettingFormValues = {}
  for (const setting of settings) values[setting.key] = toSettingFieldValue(setting)
  return values
}
