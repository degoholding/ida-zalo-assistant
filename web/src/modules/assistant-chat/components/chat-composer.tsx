import { Loader2, SendHorizontal } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/utils/cn'
import { shouldSubmitOnKeyDown } from '../utils/chat-composer-keys'

export const MAX_QUESTION_CHARS = 2000

interface ChatComposerProps {
  /** Khoá ô soạn: chưa chọn người hỏi, hoặc trợ lý đang tắt. */
  disabled: boolean
  isSending: boolean
  onSend: (question: string) => void
}

/** Ô soạn câu hỏi dưới khung chat: Enter gửi, Shift+Enter xuống dòng, đếm ký tự tới 2000. */
export function ChatComposer({ disabled, isSending, onSend }: ChatComposerProps) {
  const [text, setText] = useState('')
  const overLimit = text.length > MAX_QUESTION_CHARS
  const canSubmit = !disabled && !isSending && text.trim().length > 0 && !overLimit

  const submit = () => {
    if (!canSubmit) return
    onSend(text.trim())
    setText('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSubmitOnKeyDown({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="shrink-0 border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Trợ lý AI đang tắt' : 'Hỏi trợ lý — Enter gửi, Shift+Enter xuống dòng'}
          rows={1}
          disabled={disabled || isSending}
          className="max-h-40 min-h-9 resize-none"
          aria-label="Câu hỏi"
        />
        <Button type="button" onClick={submit} disabled={!canSubmit} title="Gửi">
          {isSending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          Gửi
        </Button>
      </div>
      <div className={cn('mt-1 text-right text-xs text-muted-foreground', overLimit && 'text-destructive')}>
        {text.length}/{MAX_QUESTION_CHARS}
      </div>
    </div>
  )
}
