import { QrCode } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { QrLoginDialog } from './qr-login-dialog'

/** «Quét QR lại» ở hàng nút dính của trang chi tiết tài khoản bot (phiên hết hạn / bị Zalo thu hồi). */
export function AccountRescanButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <QrCode />
        Quét QR lại
      </Button>
      {open && <QrLoginDialog open={open} onOpenChange={setOpen} label={label} />}
    </>
  )
}
