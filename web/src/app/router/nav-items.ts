import type { LucideIcon } from 'lucide-react'
import {
  BellRing,
  Bot,
  Building2,
  Contact,
  FileText,
  History,
  LifeBuoy,
  MessageCircle,
  MessageSquareText,
  Search,
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
