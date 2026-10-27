import type { LucideIcon } from 'lucide-react'
import {
  BellRing,
  BarChart3,
  Bot,
  Building2,
  ClipboardList,
  Contact,
  FileText,
  History,
  KeyRound,
  LifeBuoy,
  Database,
  ListChecks,
  MessageCircle,
  MessageSquareText,
  Newspaper,
  Search,
  Send,
  MessageSquareQuote,
  Settings,
  UserCog,
  Users,
} from 'lucide-react'

import type { PermissionAction, PermissionEntity } from '@/core/authorization/permission-types'
import { appRoutes } from '@/shared/constants/app-routes'

/** Mã nhóm menu trái — thứ tự hiện theo `NAV_GROUPS`. */
export type NavGroupId = 'messages' | 'follow' | 'send' | 'metrics' | 'directory' | 'system'

export interface NavGroup {
  id: NavGroupId
  label: string
}

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Nhóm trong menu trái (27/10/2026: 21 mục phẳng tách thành 6 nhóm thu gọn được). */
  group: NavGroupId
  /** Ẩn mục khi người dùng không có quyền `action` (mặc định `read`) trên thực thể này. */
  entity: PermissionEntity
  /**
   * Hành động cần có để thấy mục. Phải khớp quyền máy chủ đòi cho API của màn đó
   * (`src/web/api/route-permissions.ts`): đường API không khai riêng ở đó cần `setting.write` (chỉ quản trị) —
   * khai sai ở đây là người dùng thấy mục menu, bấm vào thì màn trống / ăn 403.
   */
  action?: PermissionAction
}

/** Sáu nhóm của menu trái, đúng thứ tự trên màn. */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'messages', label: 'Tin nhắn' },
  { id: 'follow', label: 'Theo dõi' },
  { id: 'send', label: 'Gửi tin' },
  { id: 'metrics', label: 'Số liệu' },
  { id: 'directory', label: 'Danh bạ' },
  { id: 'system', label: 'Hệ thống' },
]

/** Menu trái — thêm màn mới thì thêm một dòng ở đây (đúng nhóm) và một route ở `app-router.tsx`. */
export const NAV_ITEMS: NavItem[] = [
  // ---- Tin nhắn ----
  { label: 'Hội thoại', path: appRoutes.conversations.list, icon: MessageCircle, group: 'messages', entity: 'conversation' },
  // `/api/messages/search` khai cùng quyền xem hội thoại ở bảng quyền máy chủ
  { label: 'Tìm tin', path: appRoutes.search.messages, icon: Search, group: 'messages', entity: 'conversation' },
  { label: 'Tệp', path: appRoutes.files.list, icon: FileText, group: 'messages', entity: 'file' },
  //  `/api/assistant-chat` không khai trong bảng quyền máy chủ → chỉ quản trị (setting.write).
  { label: 'Hỏi trợ lý', path: appRoutes.assistantChat, icon: MessageSquareText, group: 'messages', entity: 'setting', action: 'write' },
  // ---- Theo dõi ----
  { label: 'Việc', path: appRoutes.tasks.list, icon: ListChecks, group: 'follow', entity: 'task' },
  { label: 'Ticket', path: appRoutes.tickets.list, icon: LifeBuoy, group: 'follow', entity: 'ticket' },
  { label: 'Bản tin', path: appRoutes.briefs.list, icon: Newspaper, group: 'follow', entity: 'brief' },
  { label: 'Người nhận', path: appRoutes.recipients.list, icon: BellRing, group: 'follow', entity: 'recipient' },
  // ---- Gửi tin ----
  { label: 'Gửi tin', path: appRoutes.sendCommands.list, icon: Send, group: 'send', entity: 'send_command' },
  // Phase 10: Mẫu tin (mọi vai trò soạn), Số liệu + Danh mục NV / ĐL (Quản trị + Quản lý). `/api/metric-sources` không khai luật → chỉ quản trị.
  { label: 'Mẫu tin', path: appRoutes.replyTemplates.list, icon: MessageSquareQuote, group: 'send', entity: 'reply_template' },
  // ---- Số liệu ----
  { label: 'Số liệu', path: appRoutes.metrics.list, icon: BarChart3, group: 'metrics', entity: 'metric' },
  { label: 'Nguồn số liệu', path: appRoutes.metricSources.list, icon: Database, group: 'metrics', entity: 'setting', action: 'write' },
  { label: 'Danh mục NV / ĐL', path: appRoutes.catalog.list, icon: ClipboardList, group: 'metrics', entity: 'catalog' },
  // ---- Danh bạ ----
  { label: 'Danh bạ', path: appRoutes.contacts.list, icon: Contact, group: 'directory', entity: 'contact' },
  { label: 'Nhóm', path: appRoutes.groups.list, icon: Users, group: 'directory', entity: 'group' },
  { label: 'Công ty', path: appRoutes.companies.list, icon: Building2, group: 'directory', entity: 'company' },
  // ---- Hệ thống ----
  { label: 'Tài khoản bot', path: appRoutes.accounts.list, icon: Bot, group: 'system', entity: 'bot_account' },
  { label: 'Người dùng', path: appRoutes.users.list, icon: UserCog, group: 'system', entity: 'user' },
  //  `/api/imports` cũng vậy — chỉ quản trị.
  { label: 'Nhập lịch sử', path: appRoutes.imports.zaloWeb, icon: History, group: 'system', entity: 'setting', action: 'write' },
  //  `GET /api/settings` cũng đòi setting.write ở máy chủ, nên gác bằng write chứ không bằng read.
  { label: 'Cài đặt', path: appRoutes.settings, icon: Settings, group: 'system', entity: 'setting', action: 'write' },
]

/**
 * Mục trong menu cá nhân (góc phải trên, cạnh tên người đăng nhập) — không nằm ở menu trái.
 * Khóa MCP: mọi vai trò quản lý khóa CỦA MÌNH (`mcp_key.read`); quản trị xem thêm khóa người khác.
 */
export const USER_MENU_ITEMS: NavItem[] = [
  { label: 'Khóa MCP', path: appRoutes.mcpKeys.list, icon: KeyRound, group: 'system', entity: 'mcp_key' },
]

/** Mọi mục có màn riêng (menu trái + menu cá nhân) — thanh đường dẫn trên cùng tra ở đây. */
export const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...USER_MENU_ITEMS]

/** Mục menu người đang đăng nhập được thấy — `can` là `usePermission().can`. */
export function selectVisibleNavItems(
  can: (entity: PermissionEntity, action: PermissionAction) => boolean,
  items: NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => can(item.entity, item.action ?? 'read'))
}

/** Nhóm menu trái kèm các mục người này thấy; nhóm không còn mục nào thì bỏ (không vẽ tiêu đề trống). */
export function selectVisibleNavGroups(
  can: (entity: PermissionEntity, action: PermissionAction) => boolean,
  items: NavItem[] = NAV_ITEMS,
  groups: NavGroup[] = NAV_GROUPS,
): Array<NavGroup & { items: NavItem[] }> {
  const visible = selectVisibleNavItems(can, items)
  return groups
    .map((group) => ({ ...group, items: visible.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length > 0)
}

/** Nhãn nhóm của một mục — dùng cho thanh đường dẫn trên cùng. */
export function navGroupLabel(item: NavItem | undefined): string | undefined {
  if (!item) return undefined
  return NAV_GROUPS.find((group) => group.id === item.group)?.label
}
