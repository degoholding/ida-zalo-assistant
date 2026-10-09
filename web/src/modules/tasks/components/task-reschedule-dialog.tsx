import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { DatePicker } from '@/shared/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { TASK_NOTE_MAX } from '../types/task'

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

interface TaskRescheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskCode: string
  pending: boolean
  onSubmit: (input: { dueDate: string; dueTime: string; note: string }) => void
}

/** Dời hạn (hoặc đặt hạn cho việc chưa có hạn) — ngày bắt buộc, giờ và ghi chú tùy chọn. */
export function TaskRescheduleDialog({ open, onOpenChange, taskCode, pending, onSubmit }: TaskRescheduleDialogProps) {
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [note, setNote] = useState('')
  const timeInvalid = dueTime !== '' && !TIME_PATTERN.test(dueTime)
  const blocked = pending || !dueDate || timeInvalid

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dời hạn {taskCode}</DialogTitle>
          <DialogDescription>Bot báo người phụ trách và người giao hạn mới qua Zalo.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!blocked) onSubmit({ dueDate, dueTime, note: note.trim() })
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-date" className="flex items-center gap-1">
                Hạn mới <span className="text-destructive">*</span>
              </Label>
              <DatePicker id="reschedule-date" value={dueDate} onChange={setDueDate} placeholder="Chọn ngày" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-time">Giờ (tùy chọn)</Label>
              <Input
                id="reschedule-time"
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                aria-invalid={timeInvalid}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-note">Ghi chú (tùy chọn)</Label>
            <Textarea
              id="reschedule-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={TASK_NOTE_MAX}
              className="max-h-40 min-h-16"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
            <Button type="submit" disabled={blocked}>
              {pending && <Loader2 className="animate-spin" />}
              Dời hạn
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
