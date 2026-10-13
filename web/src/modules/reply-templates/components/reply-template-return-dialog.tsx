import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { RETURN_NOTE_MAX, RETURN_NOTE_MIN } from '../types/reply-template'

interface ReplyTemplateReturnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (note: string) => void
}

/** Hộp thoại «Trả lại»: ghi chú BẮT BUỘC (5-500 ký tự, khớp luật máy chủ) để người soạn biết sửa gì. */
export function ReplyTemplateReturnDialog({ open, onOpenChange, pending, onSubmit }: ReplyTemplateReturnDialogProps) {
  const [note, setNote] = useState('')
  const trimmed = note.trim()
  const blocked = pending || trimmed.length < RETURN_NOTE_MIN

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trả lại mẫu tin</DialogTitle>
          <DialogDescription>Người soạn sẽ thấy ghi chú này trên mẫu, sửa rồi lưu là vào hàng chờ duyệt lại.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) onSubmit(trimmed)
          }}
        >
          <Label htmlFor="reply-template-return-note" className="flex items-center gap-1">
            Ghi chú trả lại <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="reply-template-return-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={RETURN_NOTE_MAX}
            placeholder="Vd: Thiếu hạn báo giá, sửa lại lời chào cho lịch sự hơn."
            className="max-h-64 min-h-24"
            autoFocus
          />
          <p className="text-right text-xs text-muted-foreground">
            {note.length}/{RETURN_NOTE_MAX} (tối thiểu {RETURN_NOTE_MIN})
          </p>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
            <Button type="submit" disabled={blocked}>
              {pending && <Loader2 className="animate-spin" />}
              Trả lại
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
