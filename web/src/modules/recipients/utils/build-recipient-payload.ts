import type { CrudRecord } from '@/shared/crud/types'

/**
 * Giá trị biểu mẫu người nhận → thân POST / PATCH.
 *
 * Ô «Người VIP» giữ mảng `{contact_id, name}` (để hiện chip có tên mà không hỏi lại máy chủ), còn máy chủ nhận
 * `vip_contact_ids: number[]` — đổi ở đây và BỎ `vips` khỏi thân: gửi kèm thì máy chủ phớt lờ, nhưng nhìn nhật ký
 * mạng sẽ tưởng có hai nguồn VIP. Giờ bản tin cắt khoảng trắng — « 07:30» là lỗi 422 khó nhìn ra.
 */
export function buildRecipientPayload(payload: CrudRecord): CrudRecord {
  const { vips, ...rest } = payload
  const vipIds = Array.isArray(vips)
    ? vips.map((item) => Number((item as { contact_id?: unknown } | null)?.contact_id)).filter((id) => Number.isSafeInteger(id) && id > 0)
    : []
  const result: CrudRecord = { ...rest, vip_contact_ids: [...new Set(vipIds)] }
  for (const key of ['morning_brief_at', 'evening_brief_at'] as const) {
    if (typeof result[key] === 'string') result[key] = result[key].trim()
  }
  return result
}
