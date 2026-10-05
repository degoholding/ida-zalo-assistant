import { z } from 'zod'
import type { ZodTypeAny } from 'zod'

import type { SettingView } from '../types/setting'

const INT_ERROR = 'Phải là số nguyên'

/** Đếm mục khác rỗng trong một chuỗi cách nhau bằng dấu phẩy — dùng để kiểm ô `list`. */
function countListItems(raw: string): number {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean).length
}

function buildFieldSchema(
  setting: Pick<SettingView, 'type' | 'min' | 'max' | 'max_length' | 'allow_empty' | 'secret'>,
): ZodTypeAny {
  if (setting.type === 'bool') return z.boolean()

  if (setting.type === 'int') {
    let number = z.coerce.number({ invalid_type_error: INT_ERROR }).int(INT_ERROR)
    if (setting.min !== null) number = number.min(setting.min, `Tối thiểu ${setting.min}`)
    if (setting.max !== null) number = number.max(setting.max, `Tối đa ${setting.max}`)
    return number
  }

  if (setting.type === 'list') {
    const max = setting.max
    let list: ZodTypeAny = z.string()
    if (!setting.allow_empty) {
      list = list.refine((value: string) => countListItems(value) > 0, 'Không được để trống')
    }
    if (max !== null) {
      list = list.refine((value: string) => countListItems(value) <= max, `Tối đa ${max} mục`)
    }
    return list
  }

  // 'string' và 'json' đều là một khối chữ. Ô BÍ MẬT (chuỗi hoặc json) để trống
  // luôn hợp lệ — nghĩa là "giữ nguyên giá trị cũ" — nên không ràng buộc rỗng,
  // chỉ ràng buộc độ dài khi người dùng thật sự gõ gì đó.
  if (setting.secret) {
    const maxLength = setting.max_length
    let secretText: ZodTypeAny = z.string()
    if (maxLength !== null) {
      secretText = secretText.refine(
        (value: string) => value === '' || value.length <= maxLength,
        `Tối đa ${maxLength} ký tự`,
      )
    }
    return secretText
  }

  let text = z.string()
  if (!setting.allow_empty) text = text.min(1, 'Không được để trống')
  if (setting.max_length !== null) text = text.max(setting.max_length, `Tối đa ${setting.max_length} ký tự`)
  return text
}

/**
 * Dựng schema zod cho MỘT tab từ dữ liệu `GET /api/settings` — không viết tay
 * từng ràng buộc min/max/kiểu, đọc thẳng từ `SettingView` máy chủ trả về.
 */
export function buildSettingsSchema(settings: SettingView[]): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {}
  for (const setting of settings) shape[setting.key] = buildFieldSchema(setting)
  return z.object(shape)
}
