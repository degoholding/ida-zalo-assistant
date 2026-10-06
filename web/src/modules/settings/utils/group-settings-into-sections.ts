import { Settings2 } from 'lucide-react'

import type { SettingsSection } from '../config/settings-sections'
import type { SettingView } from '../types/setting'

export interface ResolvedSettingsSection extends Omit<SettingsSection, 'keys'> {
  settings: SettingView[]
}

/**
 * Chia các khóa của một tab vào thẻ theo khai báo `sections` (giữ thứ tự khai báo). Khóa máy chủ trả về mà chưa khai
 * thẻ nào thì gom vào thẻ «Khác» cuối cùng — thêm cài đặt mới phía máy chủ không bị mất khỏi màn hình. Thẻ rỗng bị bỏ.
 */
export function groupSettingsIntoSections(sections: SettingsSection[], settings: SettingView[]): ResolvedSettingsSection[] {
  const byKey = new Map(settings.map((setting) => [setting.key, setting]))
  const placed = new Set<string>()
  const resolved: ResolvedSettingsSection[] = sections.map(({ keys, ...section }) => {
    const items = keys.flatMap((key) => {
      const setting = byKey.get(key)
      if (!setting) return []
      placed.add(key)
      return [setting]
    })
    return { ...section, settings: items }
  })
  const leftovers = settings.filter((setting) => !placed.has(setting.key))
  if (leftovers.length) {
    resolved.push({ id: 'other', title: 'Khác', description: 'Cài đặt chưa xếp nhóm.', icon: Settings2, settings: leftovers })
  }
  return resolved.filter((section) => section.settings.length > 0)
}
