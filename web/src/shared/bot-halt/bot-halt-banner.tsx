import { OctagonAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { USER_ROLE } from '@/core/auth/user-role'
import { useAuthStore } from '@/core/auth/auth-store'
import { appRoutes } from '@/shared/constants/app-routes'
import { formatHaltSince } from './format-halt-since'
import { useBotHaltStatus } from './use-bot-halt-status'

/**
 * Dải đỏ trên mọi trang khi bot đang TẮT KHẨN. Mọi người đăng nhập thấy; chỉ quản trị có link tới màn "Gửi tin" (nơi
 * bật lại). Chưa biết tình trạng (đang tải / lỗi mạng lần đầu) thì không hiện gì.
 */
export function BotHaltBanner() {
  const { data } = useBotHaltStatus()
  const isAdmin = useAuthStore((s) => s.user?.role === USER_ROLE.admin)

  if (!data?.halted) return null

  const since = formatHaltSince(data.since)
  return (
    <div role="alert" className="flex items-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-white">
      <OctagonAlert className="size-4 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        Bot đang TẮT KHẨN{since ? ` từ ${since}` : ''}
        {data.by ? ` (bởi ${data.by})` : ''} — không tin nào được gửi ra.
      </span>
      {isAdmin && (
        <Link to={appRoutes.sendCommands.list} className="ml-auto shrink-0 underline underline-offset-2">
          Mở màn Gửi tin để bật lại
        </Link>
      )}
    </div>
  )
}
