import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { useSendFile, useSendText } from '../hooks/use-conversations'

const MAX_TEXT_LENGTH = 10_000
const MAX_FILE_BYTES = 25 * 1024 * 1024

interface MessageComposerProps {
  threadId: number
  /** Tên tài khoản bot sẽ đứng tên tin — nhắc người gõ biết bên kia thấy ai nhắn. */
  botName: string
}

/**
 * Ô soạn tin dưới khung chat: Enter gửi, Shift+Enter xuống dòng; kẹp tệp / ảnh gửi từng cái.
 * Chỉ hiện với người có quyền ghi hội thoại. Tin đi ra Zalo dưới tên tài khoản bot (web chỉ có phiên của bot).
 */
export function MessageComposer({ threadId, botName }: MessageComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)
  const { can } = usePermission()
  const sendText = useSendText(threadId)
  const sendFile = useSendFile(threadId)
  const busy = sendText.isPending || sendFile.isPending
  const canSend = can('conversation', 'write')

  const submit = async () => {
    // Chốt đồng bộ: ref đổi ngay, còn `busy` (state của mutation) chỉ cập nhật sau lần render kế —
    // Enter đúp trong cùng một nhịp sẽ lọt qua nếu chỉ dựa vào `busy`.
    if (sendingRef.current || busy) return
    const body = text.trim()
    if (!body && !files.length) return
    sendingRef.current = true
    try {
      if (body) {
        // Lỗi đã có toast; giữ nguyên chữ để người gõ bấm gửi lại, không gửi tiếp tệp sau tin lỗi
        const ok = await sendText.mutateAsync(body).then(() => true, () => false)
        if (!ok) return
        setText('')
      }
      // Gửi tuần tự để thứ tự tệp đúng như người gõ chọn; chỉ gỡ tệp khỏi danh sách sau khi đã gửi xong
      for (const file of files) {
        const ok = await sendFile.mutateAsync(file).then(() => true, () => false)
        if (!ok) break
        setFiles((current) => current.filter((item) => item !== file))
      }
    } finally {
      sendingRef.current = false
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  const pickFiles = (list: FileList | null) => {
    const all = Array.from(list ?? [])
    const picked = all.filter((file) => file.size <= MAX_FILE_BYTES)
    // Máy chủ cũng chặn ở 25 MB — báo sớm ở đây để khỏi tải lên rồi mới bị từ chối
    if (picked.length !== all.length) toast.error(`Bỏ qua tệp quá ${formatFileSize(MAX_FILE_BYTES)}: ${all.filter((file) => file.size > MAX_FILE_BYTES).map((file) => file.name).join(', ')}`)
    setFiles((current) => [...current, ...picked])
    if (fileInput.current) fileInput.current.value = ''
  }

  // Nhân viên chỉ xem: máy chủ trả 403 cho mọi lệnh gửi, nên ẩn ô soạn thay vì để gõ xong mất chữ
  if (!canSend) return null

  return (
    <div className="shrink-0 border-t bg-background p-3">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file) => (
            <span key={`${file.name}-${file.size}`} className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs">
              <span className="max-w-[220px] truncate">{file.name}</span>
              <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
              <button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} disabled={busy} aria-label={`Bỏ ${file.name}`} className="rounded hover:bg-background disabled:opacity-50">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => pickFiles(event.target.files)} aria-label="Chọn tệp đính kèm" />
        <Button type="button" variant="outline" size="icon" onClick={() => fileInput.current?.click()} disabled={busy} title="Kẹp tệp / ảnh">
          <Paperclip />
        </Button>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT_LENGTH))}
          onKeyDown={handleKeyDown}
          placeholder={`Nhắn dưới tên «${botName}» — Enter gửi, Shift+Enter xuống dòng`}
          readOnly={busy}
          rows={1}
          className="max-h-40 min-h-9 resize-none"
          aria-label="Nội dung tin"
        />
        <Button type="button" onClick={() => void submit()} disabled={busy || (!text.trim() && !files.length)} title="Gửi">
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          Gửi
        </Button>
      </div>
    </div>
  )
}
