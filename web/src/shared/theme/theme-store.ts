import { create } from 'zustand'

import { queryClient } from '@/core/api'
import { logger } from '@/core/telemetry/logger'
import { queryKeys } from '@/shared/constants/query-keys'
import { applyTheme, readStoredThemeId } from './apply-theme'
import { saveThemePreference, THEME_PREFERENCE_KEY } from './theme-api'
import type { UserPreferences } from './theme-api'

/**
 * Bảng màu đang chọn.
 *
 * Nguồn thật nằm ở MÁY CHỦ (`tab_user_preference`, khoá `theme_preset`), không
 * phải localStorage — đó là cả điểm của tính năng: đăng nhập ở máy khác, trình
 * duyệt khác, vẫn thấy đúng bảng màu mình đã chọn. localStorage chỉ là bản nhớ
 * tạm để sơn màu ngay lúc tải trang, trước khi máy chủ trả lời.
 *
 * Hai đường vào state, đừng lẫn:
 * - `setTheme` — người dùng bấm chọn: sơn ngay + đẩy lên máy chủ.
 * - `syncFromServer` — máy chủ trả tuỳ chọn về: sơn theo, KHÔNG đẩy ngược lên
 *   (đẩy ngược là vòng lặp, và sẽ ghi đè lựa chọn vừa làm ở máy khác).
 */

interface ThemeState {
  themeId: string
  setTheme: (id: string) => void
  syncFromServer: (id: string | undefined) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: readStoredThemeId(),

  setTheme: (id) => {
    const applied = applyTheme(id)
    set({ themeId: applied })

    void saveThemePreference(applied)
      .then((preferences) => {
        //  Nhồi thẳng kết quả vào cache thay vì `invalidateQueries`: gọi lại một
        //  vòng nữa chỉ để nhận đúng giá trị mình vừa gửi là thừa, mà trong lúc
        //  chờ vòng đó thì `ThemeSync` đọc phải giá trị CŨ và sơn ngược lại.
        queryClient.setQueryData(queryKeys.auth.preferences(), preferences)
      })
      .catch((error) => {
        logger.warn('Chưa lưu được bảng màu lên máy chủ', error)
      })
  },

  syncFromServer: (id) => {
    const next = id || readStoredThemeId()
    if (next === get().themeId) return
    set({ themeId: applyTheme(next) })
  },
}))

/** Đọc bảng màu từ một gói tuỳ chọn bất kỳ (hồ sơ đăng nhập hoặc kết quả API). */
export function readThemeId(preferences: UserPreferences | undefined): string | undefined {
  return preferences?.[THEME_PREFERENCE_KEY]
}
