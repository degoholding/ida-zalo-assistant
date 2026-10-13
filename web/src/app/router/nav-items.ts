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

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Ẩn mục khi người dùng không có quyền `action` (mặc định `read`) trên thực thể này. */
  entity: PermissionEntity
  /**
   * Hành động cần có để thấy mục. Phải khớp quyền máy chủ đòi cho API của màn đó
   * (`src/web/api/route-permissions.ts`): đường API không khai riêng ở đó cần `setting.write` (chỉ quản trị) —
   * khai sai ở đây là người dùng thấy mục menu, bấm vào thì màn trống / ăn 403.
   */
  action?: PermissionAction
}

/** Menu trái — thêm màn mới thì thêm một dòng ở đây và một route ở `app-router.tsx`. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Hội thoại', path: appRoutes.conversations.list, icon: MessageCircle, entity: 'conversation' },
  // `/api/messages/search` khai cùng quyền xem hội thoại ở bảng quyền máy chủ
  { label: 'Tìm tin', path: appRoutes.search.messages, icon: Search, entity: 'conversation' },
  //  `/api/assistant-chat` không khai trong bảng quyền máy chủ → chỉ quản trị (setting.write).
  { label: 'Hỏi trợ lý', path: appRoutes.assistantChat, icon: MessageSquareText, entity: 'setting', action: 'write' },
  { label: 'Danh bạ', path: appRoutes.contacts.list, icon: Contact, entity: 'contact' },
  { label: 'Nhóm', path: appRoutes.groups.list, icon: Users, entity: 'group' },
  { label: 'Tệp', path: appRoutes.files.list, icon: FileText, entity: 'file' },
  { label: 'Ticket', path: appRoutes.tickets.list, icon: LifeBuoy, entity: 'ticket' },
  { label: 'Việc', path: appRoutes.tasks.list, icon: ListChecks, entity: 'task' },
  { label: 'Bản tin', path: appRoutes.briefs.list, icon: Newspaper, entity: 'brief' },
  { label: 'Gửi tin', path: appRoutes.sendCommands.list, icon: Send, entity: 'send_command' },
  // Phase 10: Mẫu tin (mọi vai trò soạn), Số liệu + Danh mục NV / ĐL (Quản trị + Quản lý). `/api/metric-sources` không khai luật → chỉ quản trị.
  { label: 'Mẫu tin', path: appRoutes.replyTemplates.list, icon: MessageSquareQuote, entity: 'reply_template' },
  { label: 'Số liệu', path: appRoutes.metrics.list, icon: BarChart3, entity: 'metric' },
  { label: 'Danh mục NV / ĐL', path: appRoutes.catalog.list, icon: ClipboardList, entity: 'catalog' },
  { label: 'Nguồn số liệu', path: appRoutes.metricSources.list, icon: Database, entity: 'setting', action: 'write' },
  //  `/api/imports` cũng vậy — chỉ quản trị.
  { label: 'Nhập lịch sử', path: appRoutes.imports.zaloWeb, icon: History, entity: 'setting', action: 'write' },
  { label: 'Công ty', path: appRoutes.companies.list, icon: Building2, entity: 'company' },
  { label: 'Người nhận', path: appRoutes.recipients.list, icon: BellRing, entity: 'recipient' },
  { label: 'Người dùng', path: appRoutes.users.list, icon: UserCog, entity: 'user' },
  { label: 'Tài khoản bot', path: appRoutes.accounts.list, icon: Bot, entity: 'bot_account' },
  //  `GET /api/settings` cũng đòi setting.write ở máy chủ, nên gác bằng write chứ không bằng read.
  { label: 'Cài đặt', path: appRoutes.settings, icon: Settings, entity: 'setting', action: 'write' },
]

/** Mục menu người đang đăng nhập được thấy — `can` là `usePermission().can`. */
export function selectVisibleNavItems(
  can: (entity: PermissionEntity, action: PermissionAction) => boolean,
  items: NavItem[] = NAV_ITEMS,
): NavItem[] {
  return items.filter((item) => can(item.entity, item.action ?? 'read'))
}
