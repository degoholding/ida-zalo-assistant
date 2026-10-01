import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

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
 * Tin đi ra Zalo dưới tên tài khoản bot (web chỉ có phiên của bot).
 */
export function MessageComposer({ threadId, botName }: MessageComposerProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const sendText = useSendText(threadId)
  const sendFile = useSendFile(threadId)
  const busy = sendText.isPending || sendFile.isPending

  const submit = async () => {
    const body = text.trim()
    if (!body && !files.length) return
    if (body) {
      await sendText.mutateAsync(body).catch(() => undefined)
      setText('')
    }
    // Gửi tuần tự để thứ tự tệp đúng như người gõ chọn
    for (const file of files) {
      const ok = await sendFile.mutateAsync(file).then(() => true, () => false)
      if (!ok) break
      setFiles((current) => current.filter((item) => item !== file))
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

  return (
    <div className="shrink-0 border-t bg-background p-3">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file) => (
            <span key={`${file.name}-${file.size}`} className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs">
              <span className="max-w-[220px] truncate">{file.name}</span>
              <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
              <button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} aria-label={`Bỏ ${file.name}`} className="rounded hover:bg-background">
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
