import { ChevronDown, LogOut } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuthStore } from '@/core/auth/auth-store'
import { usePermission } from '@/core/authorization/use-permission'
import { getUserRoleLabel } from '@/core/auth/user-role'
import { ALL_NAV_ITEMS, USER_MENU_ITEMS, navGroupLabel, selectVisibleNavItems } from '@/app/router/nav-items'
import { appRoutes } from '@/shared/constants/app-routes'
import { BotHaltBanner } from '@/shared/bot-halt/bot-halt-banner'
import { ConnectionHealthBanner } from '@/shared/connection-health/connection-health-banner'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Separator } from '@/shared/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/shared/ui/sidebar'
import { AppSidebar } from './app-sidebar'
import { useSidebarWidth } from './use-sidebar-width'

/** Khung sau đăng nhập: menu trái + thanh trên + nội dung — cùng bố cục `ModuleLayout` của ERP v2. */
export function AppLayout() {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const location = useLocation()
  const { width, setWidth } = useSidebarWidth()
  const { can } = usePermission()

  if (status === 'checking') return null
  if (status === 'signed-out') {
    return <Navigate to={appRoutes.login} replace state={{ from: location.pathname + location.search }} />
  }

  // Tra cả menu cá nhân (Khóa MCP) để thanh đường dẫn không trống khi đang ở màn đó
  const current = ALL_NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))
  const groupLabel = navGroupLabel(current)
  const roleLabel = getUserRoleLabel(user?.role)
  const userMenuItems = selectVisibleNavItems(can, USER_MENU_ITEMS)

  return (
    <SidebarProvider
      className="h-dvh overflow-hidden"
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
    >
      <AppSidebar onResizeWidth={setWidth} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
          <Separator orientation="vertical" className="mx-1 !h-4" />
          <span className="text-muted-foreground">{groupLabel ?? 'Quản trị'}</span>
          {current && (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="truncate font-medium text-navy">{current.label}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Menu cá nhân (27/10/2026): tên + vai trò, Khóa MCP của mình, Đăng xuất — không chiếm chỗ ở menu trái */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Menu cá nhân">
                  <span className="max-w-48 truncate max-sm:hidden">{user?.full_name}</span>
                  {roleLabel && <Badge variant="secondary">{roleLabel}</Badge>}
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate font-medium">{user?.full_name}</span>
                  {user?.email && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
                </DropdownMenuLabel>
                {userMenuItems.length > 0 && <DropdownMenuSeparator />}
                {userMenuItems.map((item) => (
                  <DropdownMenuItem key={item.path} asChild>
                    <Link to={item.path}>
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut className="size-4" /> Đăng xuất
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <BotHaltBanner />
        <ConnectionHealthBanner />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-canvas">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
