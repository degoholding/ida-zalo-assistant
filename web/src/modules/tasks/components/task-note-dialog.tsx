import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { TASK_NOTE_MAX } from '../types/task'

interface TaskNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  noteLabel: string
  placeholder?: string
  confirmLabel: string
  /** Bắt buộc gõ nội dung (Ghi chú); bỏ trống = ghi chú tùy chọn (Xong, Hủy). */
  required?: boolean
  /** Nút xác nhận đỏ — cho thao tác khóa việc (Hủy). */
  destructive?: boolean
  pending: boolean
  onSubmit: (note: string) => void
}

/**
 * Hộp thoại có một ô ghi chú cho các thao tác gửi kèm lời nhắn (Xong, Hủy, Ghi chú). Chặn ở đây hai luật của máy
 * chủ cho khỏi phải ăn 422: tối đa 2000 ký tự, và «Ghi chú» thì phải có nội dung.
 */
export function TaskNoteDialog({
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
}: TaskNoteDialogProps) {
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
          <Label htmlFor="task-note" className="flex items-center gap-1">
            {noteLabel}
            {required && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            id="task-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={TASK_NOTE_MAX}
            placeholder={placeholder}
            className="max-h-64 min-h-24"
            autoFocus
          />
          <p className="text-right text-xs text-muted-foreground">
            {note.length}/{TASK_NOTE_MAX}
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
