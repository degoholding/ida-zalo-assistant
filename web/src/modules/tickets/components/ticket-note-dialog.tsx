import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { TICKET_NOTE_MAX } from '../types/ticket'

interface TicketNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  noteLabel: string
  placeholder?: string
  confirmLabel: string
  /** Bắt buộc gõ nội dung (Nhắn người gửi); bỏ trống = ghi chú tùy chọn. */
  required?: boolean
  /** Nút xác nhận đỏ — cho thao tác khóa ticket (Hủy). */
  destructive?: boolean
  pending: boolean
  onSubmit: (note: string) => void
}

/**
 * Hộp thoại có một ô ghi chú cho các thao tác gửi kèm lời nhắn tới người báo (Báo xong, Hủy, Nhắn người gửi).
 * Chặn ở đây hai luật của máy chủ cho khỏi phải ăn 422: tối đa 2000 ký tự, và «Nhắn» thì phải có nội dung.
 */
export function TicketNoteDialog({
  open,
  onOpenChange,
  title,
  description,
  noteLabel,
  placeholder,
  confirmLabel,
  required,
  destructive,
  pending,
  onSubmit,
}: TicketNoteDialogProps) {
  const [note, setNote] = useState('')
  const trimmed = note.trim()
  const blocked = pending || (required && !trimmed)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) onSubmit(trimmed)
          }}
        >
          <Label htmlFor="ticket-note" className="flex items-center gap-1">
            {noteLabel}
            {required && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            id="ticket-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={TICKET_NOTE_MAX}
            placeholder={placeholder}
            className="max-h-64 min-h-24"
            autoFocus
          />
          <p className="text-right text-xs text-muted-foreground">
            {note.length}/{TICKET_NOTE_MAX}
          </p>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={blocked}>
              {pending && <Loader2 className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
