import { LogOut } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuthStore } from '@/core/auth/auth-store'
import { getUserRoleLabel } from '@/core/auth/user-role'
import { NAV_ITEMS } from '@/app/router/nav-items'
import { appRoutes } from '@/shared/constants/app-routes'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
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

  if (status === 'checking') return null
  if (status === 'signed-out') {
    return <Navigate to={appRoutes.login} replace state={{ from: location.pathname + location.search }} />
  }

  const current = NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))
  const roleLabel = getUserRoleLabel(user?.role)

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
          <span className="text-muted-foreground">Quản trị</span>
          {current && (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="truncate font-medium text-navy">{current.label}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground max-sm:hidden">
              {user?.full_name}
              {roleLabel && <Badge variant="secondary">{roleLabel}</Badge>}
            </span>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="size-4" /> Đăng xuất
            </Button>
          </div>
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-canvas">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
