import { Bot, ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

import { usePermission } from '@/core/authorization/use-permission'
import { env } from '@/core/config/env'
import { appRoutes } from '@/shared/constants/app-routes'
import { cn } from '@/shared/utils/cn'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/shared/ui/sidebar'
import { ConnectionStatusDots } from '@/shared/connection-health/connection-status-dots'
import { selectVisibleNavGroups, type NavGroupId } from '@/app/router/nav-items'
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

/** Tiêu đề nhóm là nút bấm: thu / mở nhóm; khi menu thu về cột biểu tượng thì tiêu đề tự ẩn (shadcn). */
const groupLabelClass = [
  'h-7 w-full cursor-pointer justify-between gap-2 rounded-md px-3 text-[0.6875rem] font-semibold tracking-wider',
  'text-muted-foreground uppercase hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground',
].join(' ')

const COLLAPSED_GROUPS_KEY = 'ida.sidebar.collapsed-groups'

/** Nhóm người dùng đã thu lại, nhớ giữa các phiên (mặc định mở hết). */
function readCollapsedGroups(): NavGroupId[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed.filter((value) => typeof value === 'string') as NavGroupId[]) : []
  } catch {
    return []
  }
}

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<NavGroupId[]>(readCollapsedGroups)
  const toggle = useCallback((id: NavGroupId) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next))
      } catch {
        // Trình duyệt chặn storage: vẫn thu / mở được, chỉ là không nhớ sang phiên sau.
      }
      return next
    })
  }, [])
  return { collapsed, toggle }
}

interface AppSidebarProps {
  onResizeWidth: (width: number) => void
}

export function AppSidebar({ onResizeWidth }: AppSidebarProps) {
  const { can } = usePermission()
  const { isMobile, setOpenMobile, state } = useSidebar()
  const groups = selectVisibleNavGroups(can)
  const { collapsed, toggle } = useCollapsedGroups()
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

      <SidebarContent className="gap-0 px-2 py-2">
        {groups.map((group) => {
          // Thu về cột biểu tượng thì không có tiêu đề để bấm → luôn vẽ đủ mục, kẻo mất màn.
          const isOpen = state === 'collapsed' || !collapsed.includes(group.id)
          return (
            <SidebarGroup key={group.id} className="p-0 pb-1">
              <SidebarGroupLabel asChild className={groupLabelClass}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${group.id}`}
                  onClick={() => toggle(group.id)}
                >
                  <span className="truncate">{group.label}</span>
                  <ChevronDown
                    className={cn('size-3.5 shrink-0 transition-transform duration-200', !isOpen && '-rotate-90')}
                  />
                </button>
              </SidebarGroupLabel>
              {isOpen && (
                <SidebarGroupContent id={`nav-group-${group.id}`}>
                  <SidebarMenu className="gap-1">
                    {group.items.map((item) => (
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
              )}
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      {/* Chân menu: chấm Google + phiên Zalo (chỉ quản trị) */}
      <SidebarFooter className="border-t border-border px-2 py-2">
        <ConnectionStatusDots />
      </SidebarFooter>

      <SidebarResizeHandle onResize={onResizeWidth} />
    </Sidebar>
  )
}
