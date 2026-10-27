import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/shared/ui/sidebar'
import { cn } from '@/shared/utils/cn'
import type { Dot } from './connection-health'
import { useConnectionHealth, useStartGoogleOauthFromMenu } from './use-connection-health'

const DOT_CLASS: Record<Dot, string> = {
  green: 'bg-emerald-500',
  red: 'bg-red-500 animate-pulse',
  grey: 'bg-muted-foreground/40',
}

function StatusDot({ dot }: { dot: Dot }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', DOT_CLASS[dot])} />
}

const rowClass = 'h-8 gap-2 rounded-lg px-3 text-xs text-sidebar-foreground/80 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground'

/**
 * Chân menu trái (27/10/2026): chấm Google (xanh còn hạn, đỏ hết / sắp hết) bấm là chạy luồng Kết nối Google; chấm từng
 * tài khoản bot (xanh đang nghe, đỏ cần quét QR) bấm mở Tài khoản bot. Chỉ quản trị thấy. Thu menu về cột biểu tượng thì
 * còn chấm + tooltip.
 */
export function ConnectionStatusDots() {
  const { allowed, health } = useConnectionHealth()
  const startOauth = useStartGoogleOauthFromMenu()
  if (!allowed || !health) return null

  return (
    <SidebarGroup className="p-0" data-testid="connection-status">
      <SidebarGroupLabel className="px-3 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
        Kết nối
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            tooltip={`${health.google.label} — bấm để kết nối Google`}
            className={rowClass}
            disabled={startOauth.isPending}
            onClick={() => startOauth.mutate()}
          >
            <StatusDot dot={health.google.dot} />
            <span className="truncate">{health.google.label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {health.zalo.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton asChild tooltip={`${item.label} — bấm mở Tài khoản bot`} className={rowClass}>
              <Link to={appRoutes.accounts.detail(item.id)}>
                <StatusDot dot={item.dot} />
                <span className="truncate">{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
