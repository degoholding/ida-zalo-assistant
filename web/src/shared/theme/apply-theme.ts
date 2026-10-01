import { appConfig } from '@/core/config/app-config'
import { logger } from '@/core/telemetry/logger'
import { buildThemeCss } from './build-theme-css'
import { DEFAULT_THEME_ID, themePresets } from './theme-presets'
import type { ThemePresetColors } from './theme-types'

/**
 * Sơn bảng màu lên tài liệu.
 *
 * Cách làm: một thẻ `<style>` duy nhất trong `<head>`, ghi đè nội dung mỗi lần
 * đổi. Thẻ này có thể đã tồn tại sẵn do đoạn script chặn trong `index.html` tạo
 * ra — cùng id, nên ở đây chỉ việc ghi đè, không đẻ thêm thẻ thứ hai.
 */

/** Id của thẻ `<style>` chứa bảng màu. PHẢI trùng chuỗi trong `index.html`. */
export const THEME_STYLE_ELEMENT_ID = 'erp-theme-preset'

/** Tra bảng màu theo id; không có thì trả về bảng màu DEGO mặc định. */
export function findThemePreset(id: string | null | undefined): ThemePresetColors {
  const found = id ? themePresets.find((preset) => preset.id === id) : undefined
  //  Không tìm thấy = id cũ đã bị gỡ khỏi danh sách. Rơi về mặc định thay vì để
  //  trang trắng token; người dùng chỉ thấy bảng màu quay về DEGO.
  return found ?? themePresets[0]
}

/** Đọc id bảng màu đã nhớ trong máy — dùng lúc khởi động, trước khi có hồ sơ. */
export function readStoredThemeId(): string {
  try {
    return localStorage.getItem(appConfig.storageKeys.themeId) || DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

/**
 * Sơn bảng màu `id` và nhớ lại trong máy. Trả về id thật sự được áp dụng (có thể
 * khác `id` nếu id đó không còn tồn tại).
 */
export function applyTheme(id: string): string {
  const preset = findThemePreset(id)
  const css = buildThemeCss(preset)

  let style = document.getElementById(THEME_STYLE_ELEMENT_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = THEME_STYLE_ELEMENT_ID
    document.head.appendChild(style)
  }
  style.textContent = css

  try {
    localStorage.setItem(appConfig.storageKeys.themeId, preset.id)
    localStorage.setItem(appConfig.storageKeys.themeCss, css)
  } catch (error) {
    //  Chế độ riêng tư hoặc hết dung lượng: màu vẫn đúng ở phiên này, chỉ là lần
    //  tải sau lóe một nhịp màu mặc định. Không đáng để chặn người dùng.
    logger.warn('Không nhớ được bảng màu vào localStorage', error)
  }

  return preset.id
}
