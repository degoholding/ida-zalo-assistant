import { Bot } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { usePermission } from '@/core/authorization/use-permission'
import { env } from '@/core/config/env'
import { appRoutes } from '@/shared/constants/app-routes'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/shared/ui/sidebar'
import { NAV_ITEMS } from '@/app/router/nav-items'
import { SidebarResizeHandle } from './sidebar-resize-handle'

/**
 * Lớp sơn mục menu — chép nguyên từ `module-sidebar.tsx` của ERP v2 (đọc lý do từng dòng ở bên đó):
 * hover pha từ màu chữ menu, mục đang mở dùng cặp token `--sidebar-active*`.
 */
const navItemClass = [
  'h-9 gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80',
  '[&>svg]:size-5 [&>svg]:text-sidebar-foreground/50',
  'hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground hover:[&>svg]:text-sidebar-foreground/70',
  'active:bg-sidebar-foreground/15 active:text-sidebar-foreground',
  'data-[active=true]:bg-sidebar-active data-[active=true]:font-semibold',
  'data-[active=true]:text-sidebar-active-foreground',
  'data-[active=true]:[&>svg]:text-current',
  'data-[active=true]:hover:bg-sidebar-active data-[active=true]:hover:text-sidebar-active-foreground',
  'data-[active=true]:active:bg-sidebar-active data-[active=true]:active:text-sidebar-active-foreground',
].join(' ')

const groupLabelClass =
  'px-3 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase'

interface AppSidebarProps {
  onResizeWidth: (width: number) => void
}

export function AppSidebar({ onResizeWidth }: AppSidebarProps) {
  const { can } = usePermission()
  const { isMobile, setOpenMobile } = useSidebar()
  const items = NAV_ITEMS.filter((item) => can(item.entity, 'read'))
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-border group-data-[collapsible=icon]:px-0.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={env.appName}
              className="hover:bg-transparent hover:text-current active:bg-transparent active:text-current"
            >
              <Link to={appRoutes.launcher}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Bot className="size-4" />
                </span>
                <span className="truncate font-bold">{env.appName}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2 py-3">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel className={groupLabelClass}>Quản trị</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <NavLink to={item.path} onClick={closeOnMobile}>
                    {({ isActive }) => (
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label} className={navItemClass}>
                        <span>
                          <item.icon />
                          <span>{item.label}</span>
                        </span>
                      </SidebarMenuButton>
                    )}
                  </NavLink>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarResizeHandle onResize={onResizeWidth} />
    </Sidebar>
  )
}
