import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { useContactOptions } from '@/shared/form-pickers/use-contact-options'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { SearchSelect } from '@/shared/ui/search-select'

interface TicketHandlerAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onSubmit: (contactId: number) => void
}

/** Chọn một người trong Danh bạ làm người xử lý ticket — cùng ô tra phía máy chủ như ô «Người trên Zalo» của Người nhận. */
export function TicketHandlerAddDialog({ open, onOpenChange, pending, onSubmit }: TicketHandlerAddDialogProps) {
  const [contactId, setContactId] = useState('')
  const { options, setKeyword, isFetching } = useContactOptions(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm người xử lý ticket</DialogTitle>
          <DialogDescription>Người này phải nhắn riêng được với bot trên Zalo thì mới nhận được tin báo.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="ticket-handler-contact">Người trong Danh bạ</Label>
          <SearchSelect
            id="ticket-handler-contact"
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
            Thêm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
