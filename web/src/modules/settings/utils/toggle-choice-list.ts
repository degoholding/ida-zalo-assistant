import type { SettingChoice } from '../types/setting'

/** Chuỗi «pdf, mp3» của form → tập giá trị đang tick (bỏ khoảng trắng, chữ thường, bỏ dấu chấm đầu). */
export function parseChoiceList(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set()
  return new Set(
    value
      .split(',')
      .map((item) => item.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean),
  )
}

/**
 * Tick / bỏ tick một mục → chuỗi mới cho form, xếp theo đúng thứ tự danh sách chọn (để bật rồi tắt lại một ô
 * thì chuỗi trở về như cũ, form không tưởng là đã đổi). Mục lạ không có trong danh sách chọn bị bỏ.
 */
export function toggleChoice(value: unknown, choices: SettingChoice[], choice: string, checked: boolean): string {
  const selected = parseChoiceList(value)
  if (checked) selected.add(choice)
  else selected.delete(choice)
  return choices
    .map((item) => item.value)
    .filter((item) => selected.has(item))
    .join(', ')
}

/** Gom lựa chọn theo nhóm, giữ thứ tự xuất hiện. */
export function groupChoices(choices: SettingChoice[]): { group: string; items: SettingChoice[] }[] {
  const groups: { group: string; items: SettingChoice[] }[] = []
  for (const choice of choices) {
    const existing = groups.find((entry) => entry.group === choice.group)
    if (existing) existing.items.push(choice)
    else groups.push({ group: choice.group, items: [choice] })
  }
  return groups
}
