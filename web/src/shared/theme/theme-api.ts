import { apiGet, apiPut } from '@/core/api'

/** Tuỳ chọn hiển thị cá nhân, lưu ở `tab_user_preference` phía máy chủ. */
export type UserPreferences = Record<string, string>

/** Khoá lưu bảng màu. Đổi chuỗi này là mất lựa chọn của mọi người. */
export const THEME_PREFERENCE_KEY = 'theme_preset'

export function fetchMyPreferences() {
  return apiGet<UserPreferences>('/api/me/preferences')
}

/**
 * Ghi bảng màu. Gọi ở chế độ IM LẶNG: màu đã đổi trước mắt người dùng rồi, bắn
 * thêm toast đỏ lúc mạng chập chờn chỉ làm họ tưởng thao tác hỏng. Lần chọn sau
 * sẽ ghi lại, và localStorage vẫn giữ đúng lựa chọn ở máy này.
 */
export function saveThemePreference(themeId: string) {
  return apiPut<UserPreferences>(
    '/api/me/preferences',
    { values: { [THEME_PREFERENCE_KEY]: themeId } },
    { _silent: true } as never,
  )
}
