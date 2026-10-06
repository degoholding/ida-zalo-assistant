import type { LucideIcon } from 'lucide-react'
import { Bot, Building2, Contact, FileText, History, MessageCircle, MessageSquareText, Settings, Users } from 'lucide-react'

import type { PermissionEntity } from '@/core/authorization/permission-types'
import { appRoutes } from '@/shared/constants/app-routes'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Ẩn mục khi người dùng không có quyền `read` trên thực thể này. */
  entity: PermissionEntity
}

/** Menu trái — thêm màn mới thì thêm một dòng ở đây và một route ở `app-router.tsx`. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Hội thoại', path: appRoutes.conversations.list, icon: MessageCircle, entity: 'conversation' },
  { label: 'Hỏi trợ lý', path: appRoutes.assistantChat, icon: MessageSquareText, entity: 'conversation' },
  { label: 'Danh bạ', path: appRoutes.contacts.list, icon: Contact, entity: 'contact' },
  { label: 'Nhóm', path: appRoutes.groups.list, icon: Users, entity: 'group' },
  { label: 'Tệp', path: appRoutes.files.list, icon: FileText, entity: 'file' },
  { label: 'Nhập lịch sử', path: appRoutes.imports.zaloWeb, icon: History, entity: 'group' },
  { label: 'Công ty', path: appRoutes.companies.list, icon: Building2, entity: 'company' },
  { label: 'Tài khoản bot', path: appRoutes.accounts.list, icon: Bot, entity: 'bot_account' },
  { label: 'Cài đặt', path: appRoutes.settings, icon: Settings, entity: 'setting' },
]
