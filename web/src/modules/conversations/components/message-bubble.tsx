import { ImageOff } from 'lucide-react'

import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { ImageLightbox, useImageLightbox } from '@/shared/ui/image-lightbox'
import { cn } from '@/shared/utils/cn'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { formatTime } from '@/shared/utils/format-date'
import { MESSAGE_KIND, type ChatMessage, type MessageAttachment } from '../types/conversation'

const ATTACHMENT_STORED = 1
const ATTACHMENT_PENDING = 0

const KNOWN_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'txt', 'csv']
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

function fileIconClass(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'bg-red-600'
  if (e.startsWith('xls') || e === 'csv') return 'bg-green-600'
  if (e.startsWith('doc')) return 'bg-blue-600'
  if (e.startsWith('ppt')) return 'bg-orange-600'
  return 'bg-slate-500'
}

function attachmentLabel(message: ChatMessage, attachment: MessageAttachment): string {
  if (attachment.file_name) return attachment.file_name
  if (message.kind === MESSAGE_KIND.image) return 'Hình ảnh'
  if (message.kind === MESSAGE_KIND.video) return 'Video'
  if (message.kind === MESSAGE_KIND.voice) return 'Ghi âm'
  return 'Tệp'
}

function extensionOf(attachment: MessageAttachment): string {
  return (attachment.file_ext || attachment.file_name.split('.').pop() || '').toLowerCase()
}

/** Ảnh đã có trong kho: hiện thẳng trong bong bóng, bấm phóng to (lightbox dùng chung của ERP). */
function InlineImage({ attachment, caption }: { attachment: MessageAttachment; caption: string }) {
  const lightbox = useImageLightbox()
  const url = `${attachment.download_url}?inline=1`
  return (
    <>
      <button type="button" onClick={() => lightbox.openAt(0)} className="block overflow-hidden rounded-lg" title="Phóng to">
        <img src={url} alt={caption || 'Hình ảnh'} loading="lazy" className="max-h-80 max-w-xs object-cover" />
      </button>
      <ImageLightbox images={[{ url, name: attachment.file_name || caption || 'anh' }]} {...lightbox.bind} />
    </>
  )
}

function AttachmentCard({ message, attachment }: { message: ChatMessage; attachment: MessageAttachment }) {
  const ext = extensionOf(attachment)
  const stored = attachment.status === ATTACHMENT_STORED
  if (stored && attachment.download_url && (message.kind === MESSAGE_KIND.image || IMAGE_EXTENSIONS.has(ext))) {
    return <InlineImage attachment={attachment} caption={message.text ?? ''} />
  }
  const status = stored ? formatFileSize(attachment.size) : attachment.status === ATTACHMENT_PENDING ? 'đang tải về kho…' : 'chưa có trong kho'
  const inner = (
    <>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white', fileIconClass(ext))}>
        {KNOWN_EXTENSIONS.includes(ext) ? ext.toUpperCase().slice(0, 4) : 'TỆP'}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{attachmentLabel(message, attachment)}</span>
        <span className="block text-xs text-muted-foreground">{status}</span>
      </span>
    </>
  )
  const cardClass = 'flex max-w-xs items-center gap-2 rounded-lg border bg-background/80 p-2'
  return stored && attachment.download_url ? (
    <a href={attachment.download_url} download className={cn(cardClass, 'hover:bg-muted')}>{inner}</a>
  ) : (
    <div className={cardClass}>{inner}</div>
  )
}

/** Tin ảnh / tệp mà kho không có gì (tin cũ nhập từ Zalo Web, dữ liệu đã trôi) — vẫn giữ chỗ cho dòng thời gian không thủng. */
function MissingMedia({ message }: { message: ChatMessage }) {
  const label = message.kind === MESSAGE_KIND.image ? 'Hình ảnh' : message.kind === MESSAGE_KIND.video ? 'Video' : 'Tệp'
  return (
    <span className="flex items-center gap-1.5 text-xs opacity-70">
      <ImageOff className="size-3.5" />
      {label} — Zalo không còn dữ liệu
    </span>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  isGroup: boolean
  /** Tin đầu của một đợt (hiện tên người gửi trong nhóm). */
  firstOfRun: boolean
  /** Tin cuối của một đợt (hiện ảnh đại diện). */
  lastOfRun: boolean
}

/** Tin hệ thống («Duy đã thêm Hân vào nhóm»): một dòng chữ nhỏ giữa khung chat như Zalo, không bong bóng. */
function SystemNotice({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-center py-1">
      <span className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground" title={formatTime(message.sent_at)}>
        {message.text}
      </span>
    </div>
  )
}

/** Một bong bóng: bot bên phải (màu chủ đạo), người khác bên trái. Ảnh / tên chỉ hiện ở tin đầu / cuối của đợt. */
export function MessageBubble({ message, isGroup, firstOfRun, lastOfRun }: MessageBubbleProps) {
  if (message.kind === MESSAGE_KIND.system) return <SystemNotice message={message} />
  const fromBot = message.from_bot
  const textIsFileName = message.attachment && message.text === message.attachment.file_name
  const mediaKind = message.kind === MESSAGE_KIND.image || message.kind === MESSAGE_KIND.video || message.kind === MESSAGE_KIND.file
  return (
    <div className={cn('flex items-end gap-2', fromBot ? 'justify-end' : 'justify-start')}>
      {!fromBot && isGroup && (
        lastOfRun ? (
          <EntityAvatar name={message.sender_name || '?'} avatarUrl={message.sender_avatar_url} cardUid={message.sender_contact_id ? message.sender_uid : null} className="size-8" />
        ) : (
          <span className="w-8 shrink-0" />
        )
      )}
      <div
        className={cn(
          'relative max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          fromBot ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border bg-background',
        )}
      >
        {firstOfRun && isGroup && !fromBot && <div className="mb-0.5 text-xs font-semibold text-primary">{message.sender_name || message.sender_uid}</div>}
        {message.recalled_at ? (
          <span className="italic opacity-70">Tin nhắn đã được thu hồi</span>
        ) : (
          <>
            {message.quote_text && (
              <div className={cn('mb-1 border-l-2 pl-2 text-xs opacity-80', fromBot ? 'border-primary-foreground/60' : 'border-primary')}>
                {message.quote_text.slice(0, 160)}
              </div>
            )}
            {message.attachment && <AttachmentCard message={message} attachment={message.attachment} />}
            {!message.attachment && mediaKind && !message.text && <MissingMedia message={message} />}
            {message.text && !textIsFileName && <div className="whitespace-pre-wrap break-words">{message.text}</div>}
            {message.kind === MESSAGE_KIND.sticker && !message.text && <div className="opacity-70">[Sticker]</div>}
          </>
        )}
        <span className={cn('mt-0.5 block text-right text-[10px]', fromBot ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {message.from_admin && <span title="Quản trị gõ từ web, gửi dưới tên bot">quản trị · </span>}
          {formatTime(message.sent_at)}
        </span>
      </div>
    </div>
  )
}
