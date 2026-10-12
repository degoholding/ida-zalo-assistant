import { Loader2, Power, PowerOff } from 'lucide-react'

import { USER_ROLE } from '@/core/auth/user-role'
import { useAuthStore } from '@/core/auth/auth-store'
import { useBotHaltStatus } from '@/shared/bot-halt/use-bot-halt-status'
import { useSetBotHalt } from '@/shared/bot-halt/use-set-bot-halt'
import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'

/**
 * Nút Tắt / Bật bot khẩn ở thanh đầu màn «Gửi tin» — chỉ quản trị thấy (máy chủ cũng chặn người khác). Tắt: hộp xác nhận
 * đỏ vì mọi tin gửi ra dừng ngay; Bật: xác nhận thường. Chưa biết tình trạng thì ẩn nút (không đoán hướng bấm).
 */
export function BotHaltToggleButton() {
  const isAdmin = useAuthStore((s) => s.user?.role === USER_ROLE.admin)
  const { data } = useBotHaltStatus()
  const mutation = useSetBotHalt()

  if (!isAdmin || !data) return null

  const runHalt = async () => {
    const ok = await confirm({
      title: 'Tắt bot khẩn',
      message:
        'Mọi tin bot gửi ra Zalo dừng ngay (trả lời AI, lệnh gửi, nhắc việc, cảnh báo, bản tin, ticket, gửi từ web). Bot vẫn đồng bộ và lưu tin. Việc đã đến hạn bị bỏ, không gửi bù khi bật lại.',
      confirmLabel: 'Tắt bot',
    })
    if (ok) mutation.mutate(true)
  }

  const runResume = async () => {
    const ok = await confirm({
      title: 'Bật lại bot',
      message: 'Bot gửi tin ra Zalo trở lại. Các tin đã bị bỏ lúc tắt không gửi bù.',
      confirmLabel: 'Bật bot',
      tone: 'default',
    })
    if (ok) mutation.mutate(false)
  }

  if (data.halted) {
    return (
      <Button onClick={() => void runResume()} disabled={mutation.isPending}>
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Power />}
        Bật bot
      </Button>
    )
  }
  return (
    <Button variant="destructive" onClick={() => void runHalt()} disabled={mutation.isPending}>
      {mutation.isPending ? <Loader2 className="animate-spin" /> : <PowerOff />}
      Tắt bot khẩn
    </Button>
  )
}
