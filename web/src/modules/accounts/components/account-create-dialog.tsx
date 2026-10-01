import type { CrudFormDialogProps } from '@/shared/crud/types'
import type { BotAccountDetail } from '../types/account'
import { QrLoginDialog } from './qr-login-dialog'

/** Nút «Thêm tài khoản bot» mở hộp quét QR thay cho biểu mẫu chung (tài khoản sinh ra từ lượt quét, không gõ tay). */
export function AccountCreateDialog({ open, onOpenChange, item }: CrudFormDialogProps<BotAccountDetail>) {
  return <QrLoginDialog open={open} onOpenChange={onOpenChange} label={item?.label} />
}
