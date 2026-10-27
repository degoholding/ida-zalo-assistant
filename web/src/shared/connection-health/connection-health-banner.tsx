import { Loader2, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { useConnectionHealth, useStartGoogleOauthFromMenu } from './use-connection-health'

/**
 * Dải cảnh báo đầu trang cho QUẢN TRỊ (27/10/2026), cùng kiểu dải "bot tắt khẩn": kết nối Google sắp hết / đã hết hạn,
 * hoặc tài khoản bot nào hết phiên Zalo. Nút Kết nối Google chạy luôn luồng của Cài đặt; link mở Tài khoản bot.
 */
export function ConnectionHealthBanner() {
  const { allowed, health } = useConnectionHealth()
  const startOauth = useStartGoogleOauthFromMenu()

  if (!allowed || !health || health.warnings.length === 0) return null
  const googleBad = health.google.dot === 'red'
  const zaloBad = health.zalo.some((item) => item.dot === 'red')

  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{health.warnings.join(' ')}</span>
      {googleBad && (
        <Button type="button" size="sm" variant="secondary" disabled={startOauth.isPending} onClick={() => startOauth.mutate()}>
          {startOauth.isPending ? <Loader2 className="animate-spin" /> : null}
          Kết nối Google
        </Button>
      )}
      {zaloBad && (
        <Link to={appRoutes.accounts.list} className="shrink-0 underline underline-offset-2">
          Mở Tài khoản bot
        </Link>
      )}
    </div>
  )
}
