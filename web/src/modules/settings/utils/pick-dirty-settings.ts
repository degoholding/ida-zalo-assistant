import type { SettingView } from '../types/setting'

/**
 * Chọn các khóa THẬT SỰ cần gửi lên `PATCH /api/settings`: đã đổi theo
 * `dirtyFields` của react-hook-form, và — riêng ô bí mật — không được để trống
 * (để trống nghĩa là "giữ nguyên"; muốn xóa thật thì đi qua nút Reset riêng,
 * không qua đường Lưu này).
 */
export function pickDirtySettings(
  values: Record<string, unknown>,
  dirtyFields: Record<string, boolean | undefined>,
  settings: Pick<SettingView, 'key' | 'secret'>[],
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  for (const setting of settings) {
    if (!dirtyFields[setting.key]) continue
    const value = values[setting.key]
    if (setting.secret && (value === '' || value === null || value === undefined)) continue
    changes[setting.key] = value
  }
  return changes
}
