import type { StatusTone } from '@/shared/ui/status-tone'
import { CONTACT_KIND, CONTACT_KIND_OPTIONS, CONTACT_ROLE_OPTIONS, GROUP_KIND, GROUP_KIND_OPTIONS } from './contact-constants'

/** Tên để hiện: tên quản trị đặt > tên Zalo > mã Zalo. */
export function getContactName(contact: { display_name: string; zalo_name: string; zalo_uid: string }): string {
  return contact.display_name || contact.zalo_name || contact.zalo_uid
}

/** Nhãn trong ô chọn người: tên đang dùng, kèm tên Zalo khi khác — hai người trùng tên vẫn phân biệt được. */
export function getContactOptionLabel(contact: { display_name: string; zalo_name: string; zalo_uid: string }): string {
  const name = getContactName(contact)
  return contact.zalo_name && contact.zalo_name !== name ? `${name} (${contact.zalo_name})` : name
}

export function getKindLabel(kind: number): string {
  return CONTACT_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? 'Chưa phân loại'
}

export function getRoleLabel(role: number): string {
  return CONTACT_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? ''
}

export function getGroupKindLabel(groupKind: number): string {
  return GROUP_KIND_OPTIONS.find((option) => option.value === groupKind)?.label ?? ''
}

/** Màu nhãn loại: nhân sự xanh lá, khách hàng xanh dương, chưa phân loại xám. */
export function getKindTone(kind: number): StatusTone {
  if (kind === CONTACT_KIND.staff) return 'done'
  if (kind === CONTACT_KIND.customer) return 'progress'
  return 'neutral'
}

export function getGroupKindTone(groupKind: number): StatusTone {
  return groupKind === GROUP_KIND.internal ? 'done' : 'progress'
}

/** Tách «vip, đại lý; miền Nam» thành thẻ, bỏ trùng — máy chủ còn làm sạch lần nữa, đây chỉ để gửi mảng gọn. */
export function splitTags(raw: string): string[] {
  return [...new Set(raw.split(/[,;\n]/).map((tag) => tag.trim()).filter(Boolean))]
}
