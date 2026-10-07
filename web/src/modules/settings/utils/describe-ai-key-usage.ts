import type { AiKeyItem } from '../types/ai-key'

/**
 * Dòng phụ dưới mỗi khóa, đọc thành một câu: «Trạm: … · Mô hình: … (việc nặng: …) · Trần: 200 lượt/ngày · Hôm nay 12 lượt».
 * Mô hình trống thì ghi «mặc định (tên)» để quản trị biết bot đang gọi mô hình nào.
 */
export function describeAiKeyUsage(item: AiKeyItem): string {
  const model = item.model || (item.default_model ? `mặc định (${item.default_model})` : 'mặc định')
  const heavy = item.model_heavy && item.model_heavy !== item.model ? ` (việc nặng: ${item.model_heavy})` : ''
  const cap = item.daily_cap > 0 ? `${item.daily_cap.toLocaleString('vi-VN')} lượt/ngày` : 'không giới hạn'
  return [
    item.base_url ? `Trạm: ${item.base_url}` : '',
    `Mô hình: ${model}${heavy}`,
    `Trần: ${cap}`,
    `Hôm nay ${item.used_today.toLocaleString('vi-VN')} lượt`,
  ]
    .filter(Boolean)
    .join(' · ')
}
