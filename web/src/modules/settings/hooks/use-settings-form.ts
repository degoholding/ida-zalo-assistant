import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'

import { buildSettingsDefaultValues } from '../utils/build-settings-default-values'
import { buildSettingsSchema } from '../utils/build-settings-schema'
import type { SettingFormValues, SettingView } from '../types/setting'

/**
 * Form dùng chung cho một tab: schema + giá trị khởi tạo dựng từ dữ liệu
 * `GET /api/settings`.
 *
 * Giá trị khởi tạo chỉ tính MỘT LẦN khi phân hệ mở (`useState` khởi tạo lười),
 * KHÔNG đồng bộ ngược mỗi khi dữ liệu toàn cục đổi — tab Google Lưu xong thì
 * tab Trợ lý AI đang gõ dở không bị xóa trắng vì cả màn dùng chung một query.
 * Mỗi lần Lưu / Khôi phục mặc định tự `form.reset()` / `form.resetField()`
 * bằng đúng dữ liệu trả về của lượt gọi đó — xem `settings-sections-form.tsx`.
 */
export function useSettingsForm(settings: SettingView[]) {
  const schema = useMemo(() => buildSettingsSchema(settings), [settings])
  const [defaultValues] = useState<SettingFormValues>(() => buildSettingsDefaultValues(settings))

  // why: schema dựng ĐỘNG từ dữ liệu API (mỗi khóa một kiểu), zod không suy ra
  // nổi kiểu tĩnh khớp `SettingFormValues` — ép kiểu tại đúng ranh giới này,
  // không để `any` lọt ra khỏi hook.
  const resolver = zodResolver(schema) as Resolver<SettingFormValues>

  return useForm<SettingFormValues>({ resolver, defaultValues })
}
