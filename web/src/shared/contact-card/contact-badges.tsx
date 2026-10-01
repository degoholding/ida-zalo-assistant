import { Pill } from '@/shared/ui/pill'
import { CONTACT_KIND_SOURCE } from './contact-constants'
import { getGroupKindLabel, getGroupKindTone, getKindLabel, getKindTone, getRoleLabel } from './format-contact'

/** Nhãn loại người; tài khoản bot thì luôn hiện «Bot» thay cho khách hàng / nhân sự. */
export function KindBadge({ kind, isBot, className }: { kind: number; isBot?: boolean; className?: string }) {
  if (isBot) return <Pill className={className ? `bg-navy text-white ${className}` : 'bg-navy text-white'}>Bot</Pill>
  return <Pill tone={getKindTone(kind)} className={className}>{getKindLabel(kind)}</Pill>
}

export function KindSourceHint({ kindSource }: { kindSource: number }) {
  return <span className="text-xs text-muted-foreground">{kindSource === CONTACT_KIND_SOURCE.auto ? 'tự động' : 'chỉnh tay'}</span>
}

/** Vai trò > 0 = bot trả lời người này; 0 = chỉ lưu tin. */
export function RoleBadge({ role, className }: { role: number; className?: string }) {
  if (!role) return <span className="text-xs text-muted-foreground">Chỉ lưu</span>
  return <Pill tone="pending" className={className}>Hỏi được bot · {getRoleLabel(role)}</Pill>
}

export function GroupKindBadge({ groupKind, className }: { groupKind: number; className?: string }) {
  return <Pill tone={getGroupKindTone(groupKind)} className={className}>{getGroupKindLabel(groupKind)}</Pill>
}

export function TagBadges({ tags, className }: { tags: string[]; className?: string }) {
  if (!tags.length) return <span className="text-muted-foreground">—</span>
  return (
    <span className={className ? `flex flex-wrap gap-1 ${className}` : 'flex flex-wrap gap-1'}>
      {tags.map((tag) => (
        <Pill key={tag} tone="handoff">{tag}</Pill>
      ))}
    </span>
  )
}
