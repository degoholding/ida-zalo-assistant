import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { cn } from '@/shared/utils/cn'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { formatTime } from '@/shared/utils/format-date'
import { MESSAGE_KIND, type ChatMessage, type MessageAttachment } from '../types/conversation'

const ATTACHMENT_STORED = 1
const ATTACHMENT_PENDING = 0

const KNOWN_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'txt', 'csv']

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

function AttachmentCard({ message, attachment }: { message: ChatMessage; attachment: MessageAttachment }) {
  const ext = attachment.file_ext || attachment.file_name.split('.').pop() || ''
  const stored = attachment.status === ATTACHMENT_STORED
  const status = stored ? formatFileSize(attachment.size) : attachment.status === ATTACHMENT_PENDING ? 'đang tải về kho…' : 'chưa có trong kho'
  const inner = (
    <>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white', fileIconClass(ext))}>
        {KNOWN_EXTENSIONS.includes(ext.toLowerCase()) ? ext.toUpperCase().slice(0, 4) : 'TỆP'}
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

interface MessageBubbleProps {
  message: ChatMessage
  isGroup: boolean
  /** Tin đầu của một đợt (hiện tên người gửi trong nhóm). */
  firstOfRun: boolean
  /** Tin cuối của một đợt (hiện ảnh đại diện). */
  lastOfRun: boolean
}

/** Một bong bóng: bot bên phải (màu chủ đạo), người khác bên trái. Ảnh / tên chỉ hiện ở tin đầu / cuối của đợt. */
export function MessageBubble({ message, isGroup, firstOfRun, lastOfRun }: MessageBubbleProps) {
  const fromBot = message.from_bot
  const textIsFileName = message.attachment && message.text === message.attachment.file_name
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
