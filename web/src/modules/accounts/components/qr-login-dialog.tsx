import { Loader2, QrCode } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { cn } from '@/shared/utils/cn'
import { useQrLoginState, useStartQrLogin } from '../hooks/use-qr-login'

const LABEL_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

interface QrLoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Có sẵn nhãn (quét lại tài khoản cũ) thì bỏ qua bước nhập nhãn. */
  label?: string
}

/**
 * Thêm tài khoản bot / quét QR lại: nhập nhãn → máy chủ xin mã QR từ Zalo → hiện ảnh → hỏi trạng thái
 * tới khi điện thoại xác nhận. Thành công thì bot chạy ngay, không cần khởi động lại.
 */
export function QrLoginDialog({ open, onOpenChange, label: presetLabel }: QrLoginDialogProps) {
  const [label, setLabel] = useState(presetLabel ?? '')
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const start = useStartQrLogin()
  const { data: state } = useQrLoginState(attemptId)
  const labelValid = LABEL_PATTERN.test(label.trim())

  const handleStart = (event?: FormEvent) => {
    event?.preventDefault()
    if (!labelValid) return
    start.mutate(label.trim(), { onSuccess: (attempt) => setAttemptId(attempt.id) })
  }

  const phase = state?.phase
  const finished = phase === 'success' || phase === 'failed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{presetLabel ? `Quét QR lại — «${presetLabel}»` : 'Thêm tài khoản bot'}</DialogTitle>
          <DialogDescription>
            Mở app Zalo của tài khoản bot → biểu tượng QR → quét mã. Không mở Zalo Web bằng tài khoản bot: mỗi tài khoản chỉ
            một phiên web, mở là bot bị đá ra.
          </DialogDescription>
        </DialogHeader>

        {!attemptId ? (
          <form onSubmit={handleStart} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qr-label">Nhãn</Label>
              <Input
                id="qr-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="vd bot-1"
                maxLength={100}
                readOnly={Boolean(presetLabel)}
                autoFocus={!presetLabel}
              />
              <p className="text-xs text-muted-foreground">Chữ không dấu, số, gạch ngang, gạch dưới. Dùng lại nhãn cũ = quét lại cho tài khoản đó.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Đóng</Button>
              <Button type="submit" disabled={!labelValid || start.isPending}>
                {start.isPending ? <Loader2 className="animate-spin" /> : <QrCode />}
                Lấy mã QR
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            {state?.qr_image ? (
              <img src={state.qr_image} alt="Mã QR đăng nhập Zalo" className="size-64 rounded-md border" />
            ) : (
              <div className="flex size-64 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                {finished ? <QrCode className="size-10" /> : <Loader2 className="size-8 animate-spin" />}
              </div>
            )}
            <p className={cn('text-sm', phase === 'failed' && 'text-destructive', phase === 'success' && 'text-success')} aria-live="polite">
              {state?.message ?? 'Đang lấy mã QR từ Zalo…'}
            </p>
            <div className="flex gap-2">
              {phase === 'failed' && <Button variant="outline" onClick={() => setAttemptId(null)}>Thử lại</Button>}
              <Button variant={phase === 'success' ? 'default' : 'outline'} onClick={() => onOpenChange(false)}>
                {phase === 'success' ? 'Xong' : 'Đóng'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
