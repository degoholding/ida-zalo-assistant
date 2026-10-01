import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

import { GroupKindBadge, KindBadge, RoleBadge, TagBadges } from '@/shared/contact-card/contact-badges'
import { ContactProfileForm } from '@/shared/contact-card/contact-profile-form'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { getContactName } from '@/shared/contact-card/format-contact'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { Pill } from '@/shared/ui/pill'
import { Separator } from '@/shared/ui/separator'
import { formatDateTime } from '@/shared/utils/format-date'
import type { ThreadDetail } from '../types/conversation'

function PanelHeader({ name, avatarUrl, shape, sub, detailTo }: { name: string; avatarUrl: string | null; shape: 'circle' | 'rounded'; sub: string; detailTo: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-4 text-center">
      <EntityAvatar name={name} avatarUrl={avatarUrl} shape={shape} className="size-20 text-xl" />
      <div className="text-base font-semibold text-navy">{name}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
      <Button variant="outline" size="sm" asChild>
        <Link to={detailTo}>
          <ExternalLink />
          Trang chi tiết
        </Link>
      </Button>
    </div>
  )
}

/** Cột phải: hồ sơ người (sửa được tại chỗ) hoặc hồ sơ nhóm + thành viên. */
export function ConversationProfilePanel({ thread }: { thread: ThreadDetail }) {
  if (thread.contact) {
    const contact = thread.contact
    const name = getContactName(contact)
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background max-xl:hidden">
        <PanelHeader name={name} avatarUrl={contact.avatar_url} shape="circle" sub={`Mã Zalo ${contact.zalo_uid}`} detailTo={appRoutes.contacts.detail(contact.id)} />
        <div className="flex flex-wrap justify-center gap-1 px-4">
          <KindBadge kind={contact.kind} isBot={contact.is_bot} />
          {contact.role > 0 && <RoleBadge role={contact.role} />}
          {contact.tags.length > 0 && <TagBadges tags={contact.tags} />}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-4 text-sm">
          <dt className="text-muted-foreground">Nhắn riêng</dt>
          <dd className="text-right">{contact.dm_count ? `${contact.dm_count} tin` : 'Chưa'}</dd>
          <dt className="text-muted-foreground">Gần nhất</dt>
          <dd className="text-right">{formatDateTime(contact.last_dm_at) || '—'}</dd>
          <dt className="text-muted-foreground">Ở nhóm</dt>
          <dd className="text-right">{contact.group_count} nhóm</dd>
        </dl>
        <Separator />
        <div className="p-4">
          <ContactProfileForm key={contact.id} contact={contact} />
        </div>
      </aside>
    )
  }

  if (!thread.group) return null
  const group = thread.group
  const name = group.label || group.name || '(chưa rõ tên)'
  const activeMembers = group.members.filter((member) => !member.left_at)
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l bg-background max-xl:hidden">
      <PanelHeader name={name} avatarUrl={group.avatar_url} shape="rounded" sub={`${group.member_count} thành viên · mã ${group.zalo_group_id}`} detailTo={appRoutes.groups.detail(group.id)} />
      <div className="flex flex-wrap justify-center gap-1 px-4">
        <GroupKindBadge groupKind={group.group_kind} />
        {group.read_messages ? <Pill tone="done">Đang đọc tin</Pill> : <Pill tone="neutral">Không đọc</Pill>}
        {group.capture_files ? <Pill tone="done">Lấy file</Pill> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-4 text-sm">
        <dt className="text-muted-foreground">Công ty</dt>
        <dd className="text-right">{group.company_name ?? 'Chưa gán'}</dd>
        <dt className="text-muted-foreground">Lưu tin</dt>
        <dd className="text-right">{group.retention_days} ngày</dd>
      </dl>
      <Separator />
      <div className="px-4 pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Thành viên ({activeMembers.length})</div>
      <ul className="flex flex-col py-2">
        {activeMembers.map((member) => (
          <li key={member.zalo_uid} className="flex items-center gap-2 px-4 py-1.5">
            <EntityAvatar name={member.name} avatarUrl={member.avatar_url} cardUid={member.contact_id ? member.zalo_uid : null} className="size-8" />
            <span className="min-w-0 flex-1">
              {member.direct_thread_id ? (
                <Link to={appRoutes.conversations.detail(member.direct_thread_id)} className="block truncate text-sm hover:underline" title="Mở cuộc riêng với bot">{member.name}</Link>
              ) : (
                <span className="block truncate text-sm">{member.name}</span>
              )}
              {member.is_admin && <span className="text-xs text-muted-foreground">Trưởng / phó nhóm</span>}
            </span>
            <KindBadge kind={member.kind} isBot={member.is_bot} />
          </li>
        ))}
      </ul>
    </aside>
  )
}
