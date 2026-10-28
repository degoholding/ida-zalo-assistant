import { Loader2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { extractErrorMessage } from '@/core/api'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { useAccountPurgePreview, usePurgeAccount } from '../hooks/use-account-purge'
import type { AccountPurgePreview } from '../types/account'
import { canConfirmPurge } from '../utils/can-confirm-purge'

function PurgeSummary({ preview }: { preview: AccountPurgePreview }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      <li>{preview.direct_count} cuộc trò chuyện riêng của tài khoản này</li>
      <li>{preview.solo_group_count} nhóm chỉ có tài khoản này</li>
      <li>{preview.message_count} tin, {preview.attachment_count} tệp ({preview.stored_file_count} tệp trong kho, {formatFileSize(preview.stored_bytes)})</li>
      <li className="text-muted-foreground">Giữ nguyên {preview.shared_group_count} nhóm có tài khoản khác, chỉ bỏ liên kết</li>
    </ul>
  )
}

/** "Xóa kèm dữ liệu" ở trang chi tiết — CHỈ hiện cho tài khoản thử (máy chủ cũng từ chối tài khoản thật). */
export function AccountPurgeButton({ accountId, label }: { accountId: number; label: string }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [backupConfirmed, setBackupConfirmed] = useState(false)
  // Chặn bấm đúp ngay trong tick — `isPending` chỉ đúng ở lần render sau
  const submitting = useRef(false)
  const navigate = useNavigate()
  const preview = useAccountPurgePreview(accountId, open)
  const purge = usePurgeAccount(accountId)

  const close = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setTyped('')
      setBackupConfirmed(false)
    }
  }

  const ready = canConfirmPurge(typed, label, backupConfirmed) && preview.isSuccess
  const handleConfirm = () => {
    if (!ready || submitting.current) return
    submitting.current = true
    purge.mutate({ confirm_label: typed, backup_confirmed: true }, {
      onSuccess: () => {
        close(false)
        navigate(appRoutes.accounts.list)
      },
      onSettled: () => { submitting.current = false },
    })
  }

  return (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 />
        Xóa kèm dữ liệu
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa tài khoản thử "{label}"</DialogTitle>
            <DialogDescription>
              Xóa hẳn tài khoản và dữ liệu dưới đây, không khôi phục được. Phiên Zalo của tài khoản sẽ dừng trước khi xóa.
            </DialogDescription>
          </DialogHeader>
          {preview.isLoading && <p className="text-sm text-muted-foreground">Đang đếm dữ liệu sẽ xóa…</p>}
          {preview.isError && <p className="text-sm text-destructive">{extractErrorMessage(preview.error)}</p>}
          {preview.data && <PurgeSummary preview={preview.data} />}
          <div className="space-y-1.5">
            <Label htmlFor="purge-confirm-label">Gõ lại nhãn tài khoản để xác nhận</Label>
            <Input id="purge-confirm-label" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={label} autoComplete="off" />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="purge-backup" checked={backupConfirmed} onCheckedChange={(value) => setBackupConfirmed(value === true)} />
            <Label htmlFor="purge-backup" className="leading-snug font-normal">
              Đã sao lưu dữ liệu chưa? Tôi xác nhận đã sao lưu cơ sở dữ liệu trước khi xóa.
            </Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => close(false)}>Hủy</Button>
            <Button type="button" variant="destructive" disabled={!ready || purge.isPending} onClick={handleConfirm}>
              {purge.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Xóa vĩnh viễn
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
