import { useState, type MouseEvent } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar'
import { cn } from '@/shared/utils/cn'
import { nameInitials } from '@/shared/utils/name-initials'
import { ContactCardDialog } from './contact-card-dialog'

interface EntityAvatarProps {
  name: string
  avatarUrl: string | null
  /** Nhóm thì bo góc vuông nhẹ cho khác người. */
  shape?: 'circle' | 'rounded'
  /** Có mã Zalo thì bấm ảnh mở thẻ hồ sơ nổi kiểu Zalo. */
  cardUid?: string | null
  className?: string
}

/** Ảnh đại diện người / nhóm (đã tải về kho của bot); chưa có ảnh thì chữ viết tắt. Có `cardUid` → bấm mở thẻ nổi. */
export function EntityAvatar({ name, avatarUrl, shape = 'circle', cardUid, className }: EntityAvatarProps) {
  const [open, setOpen] = useState(false)
  const avatar = (
    <Avatar className={cn('size-9', shape === 'rounded' && 'rounded-md', className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" className="object-cover" />}
      <AvatarFallback className={cn('bg-muted-foreground/70 text-xs font-semibold text-white', shape === 'rounded' && 'rounded-md')}>
        {nameInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
  if (!cardUid) return avatar

  const handleClick = (event: MouseEvent) => {
    // Ảnh nằm trong dòng bảng: không cho cú bấm lan lên `onRowClick` (mở trang chi tiết)
    event.stopPropagation()
    setOpen(true)
  }
  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Xem nhanh hồ sơ"
        className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring hover:ring-2 hover:ring-primary"
      >
        {avatar}
      </button>
      {open && <ContactCardDialog uid={cardUid} open={open} onOpenChange={setOpen} />}
    </>
  )
}
