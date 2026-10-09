import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { useContactOptions } from '@/shared/form-pickers/use-contact-options'
import { filterLookupOptions, useThreadLookup } from '@/shared/lookups/use-lookups'
import { Button } from '@/shared/ui/button'
import { DatePicker } from '@/shared/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { SearchSelect } from '@/shared/ui/search-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { useCreateTask } from '../hooks/use-create-task'
import { TASK_PRIORITY, TASK_PRIORITY_OPTIONS } from '../types/task'

interface TaskCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** Tạo việc trên web — việc, người phụ trách, hạn (ngày + giờ tùy chọn), ưu tiên, nhóm nguồn (tùy chọn). */
export function TaskCreateDialog({ open, onOpenChange }: TaskCreateDialogProps) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState(String(TASK_PRIORITY.normal))
  const [threadId, setThreadId] = useState('')
  const { options: contactOptions, setKeyword, isFetching } = useContactOptions(open)
  const { data: threads = [] } = useThreadLookup()
  const mutation = useCreateTask()

  const timeInvalid = dueTime !== '' && !TIME_PATTERN.test(dueTime)
  const blocked = mutation.isPending || !title.trim() || timeInvalid || (dueTime !== '' && !dueDate)

  const submit = () => {
    if (blocked) return
    mutation.mutate(
      {
        title: title.trim(),
        assignee_contact_id: assigneeId ? Number(assigneeId) : undefined,
        due_date: dueDate || undefined,
        due_time: dueTime || undefined,
        priority: Number(priority),
        source_thread_id: threadId ? Number(threadId) : undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm việc</DialogTitle>
          <DialogDescription>Bot báo ngay người phụ trách qua Zalo (nếu đã chọn người).</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="task-title" className="flex items-center gap-1">
              Việc <span className="text-destructive">*</span>
            </Label>
            <Textarea id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} className="max-h-40 min-h-16" autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-assignee">Người phụ trách</Label>
            <SearchSelect
              id="task-assignee"
              value={assigneeId}
              onChange={setAssigneeId}
              options={contactOptions}
              onSearchChange={setKeyword}
              clearable
              placeholder="Chọn người trong Danh bạ"
              searchPlaceholder="Gõ tên, mã Zalo, ghi chú…"
              emptyMessage={isFetching ? 'Đang tìm…' : 'Không có ai khớp.'}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-due-date">Hạn</Label>
              <DatePicker id="task-due-date" value={dueDate} onChange={setDueDate} placeholder="Chưa chọn ngày" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due-time">Giờ (tùy chọn)</Label>
              <Input
                id="task-due-time"
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                aria-invalid={timeInvalid}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">Ưu tiên</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-thread">Nhóm (tùy chọn)</Label>
              <SearchSelect
                id="task-thread"
                value={threadId}
                onChange={setThreadId}
                options={filterLookupOptions(threads, '')}
                clearable
                placeholder="Không gắn nhóm"
                searchPlaceholder="Gõ tên nhóm…"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
            <Button type="submit" disabled={blocked}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Thêm việc
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
