import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog'
import { formatDateTime } from '@/shared/utils/format-date'
import { nameInitials } from '@/shared/utils/name-initials'
import { KindBadge, RoleBadge, TagBadges } from './contact-badges'
import { getContactName } from './format-contact'
import { useContactCard } from './use-contact-card'

interface ContactCardDialogProps {
  uid: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Thẻ hồ sơ nổi kiểu Zalo: ảnh lớn trên nền màu chủ đạo, tên, nhãn, vài số liệu, hai nút. */
export function ContactCardDialog({ uid, open, onOpenChange }: ContactCardDialogProps) {
  const { data: contact, isLoading, isError } = useContactCard(uid)
  const name = contact ? getContactName(contact) : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-sm">
        <div className="h-24 bg-linear-to-br from-primary to-navy" />
        {isLoading && <p className="p-6 text-center text-sm text-muted-foreground">Đang tải…</p>}
        {isError && <p className="p-6 text-center text-sm text-destructive">Không tải được hồ sơ người này.</p>}
        {contact && (
          <div className="flex flex-col items-center gap-2 px-5 pb-5 text-center">
            <Avatar className="-mt-12 size-24 border-4 border-background">
              {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt="" className="object-cover" />}
              <AvatarFallback className="bg-muted-foreground/70 text-2xl font-semibold text-white">{nameInitials(name)}</AvatarFallback>
            </Avatar>
            <DialogTitle className="text-lg text-navy">{name}</DialogTitle>
            <DialogDescription className="text-xs">
              {contact.zalo_name && contact.zalo_name !== name ? `Tên Zalo: ${contact.zalo_name}` : `Mã Zalo ${contact.zalo_uid}`}
            </DialogDescription>
            <div className="flex flex-wrap justify-center gap-1">
              <KindBadge kind={contact.kind} isBot={contact.is_bot} />
              {contact.role > 0 && <RoleBadge role={contact.role} />}
              {contact.tags.length > 0 && <TagBadges tags={contact.tags} />}
            </div>
            <dl className="mt-2 grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-left text-sm">
              <dt className="text-muted-foreground">Công ty</dt>
              <dd className="text-right">{contact.company_name ?? '—'}</dd>
              <dt className="text-muted-foreground">Ở các nhóm</dt>
              <dd className="text-right">{contact.group_count} nhóm</dd>
              <dt className="text-muted-foreground">Nhắn riêng bot</dt>
              <dd className="text-right">{contact.dm_count ? `${contact.dm_count} tin · ${formatDateTime(contact.last_dm_at)}` : 'Chưa nhắn'}</dd>
              <dt className="text-muted-foreground">Ghi chú</dt>
              <dd className="line-clamp-2 text-right">{contact.note || '—'}</dd>
            </dl>
            <div className="mt-3 flex gap-2">
              {contact.direct_thread_id && (
                <Button variant="outline" size="sm" asChild onClick={() => onOpenChange(false)}>
                  <Link to={appRoutes.conversations.detail(contact.direct_thread_id)}>Mở hội thoại</Link>
                </Button>
              )}
              <Button size="sm" asChild onClick={() => onOpenChange(false)}>
                <Link to={appRoutes.contacts.detail(contact.id)}>Xem chi tiết</Link>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
