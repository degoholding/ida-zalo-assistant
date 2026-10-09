import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { useContactOptions } from '@/shared/form-pickers/use-contact-options'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { SearchSelect } from '@/shared/ui/search-select'

interface TaskReassignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskCode: string
  currentAssigneeName: string
  pending: boolean
  onSubmit: (contactId: number) => void
}

/** Giao lại việc cho người khác trong Danh bạ — báo người mới có việc, báo người cũ việc đã chuyển. */
export function TaskReassignDialog({ open, onOpenChange, taskCode, currentAssigneeName, pending, onSubmit }: TaskReassignDialogProps) {
  const [contactId, setContactId] = useState('')
  const { options, setKeyword, isFetching } = useContactOptions(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Giao lại {taskCode}</DialogTitle>
          <DialogDescription>
            Đang giao cho {currentAssigneeName || 'chưa có người phụ trách'}. Bot báo người mới có việc, báo người cũ việc đã chuyển.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="reassign-contact">Người phụ trách mới</Label>
          <SearchSelect
            id="reassign-contact"
            value={contactId}
            onChange={setContactId}
            options={options}
            onSearchChange={setKeyword}
            placeholder="Chọn người trong Danh bạ"
            searchPlaceholder="Gõ tên, mã Zalo, ghi chú…"
            emptyMessage={isFetching ? 'Đang tìm…' : 'Không có ai khớp.'}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button disabled={!contactId || pending} onClick={() => onSubmit(Number(contactId))}>
            {pending && <Loader2 className="animate-spin" />}
            Giao lại
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
