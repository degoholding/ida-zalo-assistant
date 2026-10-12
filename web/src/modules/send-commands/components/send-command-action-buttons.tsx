import { CircleX, Loader2, RotateCcw } from 'lucide-react'

import { USER_ROLE } from '@/core/auth/user-role'
import { useAuthStore } from '@/core/auth/auth-store'
import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { useSendCommandAction } from '../hooks/use-send-command-action'
import { formatSendCommandCode, type SendCommandDetail } from '../types/send-command'
import { getSendCommandActions } from '../utils/get-send-command-actions'

/**
 * Nút thao tác ở trang chi tiết lệnh gửi: «Hủy lệnh» (chờ xác nhận / đang hẹn — ai thấy lệnh cũng hủy được, phạm vi lệnh
 * do máy chủ giữ) và «Gửi lại nơi lỗi» (chỉ quản trị). Nút nào hiện theo `getSendCommandActions`.
 */
export function SendCommandActionButtons({ command }: { command: SendCommandDetail }) {
  const { can } = usePermission()
  const isAdmin = useAuthStore((s) => s.user?.role === USER_ROLE.admin)
  const mutation = useSendCommandAction(command.id)

  if (!can('send_command', 'write')) return null

  const actions = getSendCommandActions(command, Boolean(isAdmin))
  const busy = mutation.isPending
  const code = formatSendCommandCode(command.id)

  const runCancel = async () => {
    const ok = await confirm({
      title: `Hủy lệnh ${code}`,
      message: 'Các nơi chưa gửi sẽ không gửi nữa. Lệnh đã hủy không mở lại được — muốn gửi thì ra lệnh mới.',
      confirmLabel: 'Hủy lệnh',
    })
    if (ok) mutation.mutate({ action: 'cancel' })
  }

  const runResend = async () => {
    const ok = await confirm({
      title: `Gửi lại nơi lỗi của ${code}`,
      message: 'Bot gửi lại ngay cho các nơi đang lỗi. Không báo lại người ra lệnh.',
      confirmLabel: 'Gửi lại',
      tone: 'default',
    })
    if (ok) mutation.mutate({ action: 'resend_failed' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('cancel') && (
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => void runCancel()} disabled={busy}>
          {busy && mutation.variables?.action === 'cancel' ? <Loader2 className="animate-spin" /> : <CircleX />}
          Hủy lệnh
        </Button>
      )}
      {actions.includes('resend_failed') && (
        <Button size="sm" variant="outline" onClick={() => void runResend()} disabled={busy}>
          {busy && mutation.variables?.action === 'resend_failed' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Gửi lại nơi lỗi
        </Button>
      )}
    </div>
  )
}
