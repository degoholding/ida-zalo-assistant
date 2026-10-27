import { describe, expect, it } from 'vitest'

import { ENTITIES, type PermissionAction, type PermissionEntity } from '@/core/authorization/permission-types'
import { appRoutes } from '@/shared/constants/app-routes'
import { ALL_NAV_ITEMS, NAV_GROUPS, NAV_ITEMS, USER_MENU_ITEMS, navGroupLabel, selectVisibleNavGroups, selectVisibleNavItems } from './nav-items'

/**
 * Ma trận quyền CHÉP TAY từ `permissionsFor` ở máy chủ (`src/auth/principal.ts`) — đổi bên đó thì sửa ở đây.
 * Bài này chốt chuyện: người không phải quản trị KHÔNG thấy mục menu mà bấm vào chỉ ăn 403
 * (Hỏi trợ lý, Nhập lịch sử, Cài đặt, Tài khoản bot, Người dùng, Người nhận).
 */
const ADMIN_ONLY: PermissionEntity[] = ['bot_account', 'setting', 'user', 'recipient', 'audit']

function buildPermissions(role: 'admin' | 'manager' | 'staff') {
  return Object.fromEntries(
    ENTITIES.map((entity) => {
      if (role === 'admin') return [entity, { read: true, write: true, export: true, create: true, approve: true }]
      // Phase 10: mẫu tin mọi vai trò soạn, Quản lý duyệt; số liệu + danh mục chỉ Quản lý xem (nhân viên không)
      if (entity === 'reply_template') return [entity, { read: true, write: true, export: false, create: true, approve: role === 'manager' }]
      if (entity === 'metric') return [entity, { read: role === 'manager', write: false, export: role === 'manager', create: false, approve: false }]
      // Khóa MCP: mọi vai trò quản lý khóa CỦA MÌNH
      if (entity === 'mcp_key') return [entity, { read: true, write: true, export: false, create: true, approve: false }]
      if (entity === 'catalog') return [entity, { read: role === 'manager', write: false, export: false, create: false, approve: false }]
      if (ADMIN_ONLY.includes(entity)) return [entity, { read: false, write: false, export: false, create: false }]
      const canWrite = (role === 'manager' && ['conversation', 'contact', 'group', 'file', 'ticket', 'task'].includes(entity)) || entity === 'send_command'
      return [entity, { read: true, write: canWrite, export: role === 'manager', create: false }]
    }),
  ) as Record<string, Record<string, boolean>>
}

function canFor(role: 'admin' | 'manager' | 'staff') {
  const permissions = buildPermissions(role)
  return (entity: PermissionEntity, action: PermissionAction) => Boolean(permissions[entity]?.[action])
}

function visibleLabels(role: 'admin' | 'manager' | 'staff') {
  return selectVisibleNavItems(canFor(role)).map((item) => item.label)
}

describe('sidebar gating by role', () => {
  it('shows an admin every menu item, including the new Users and Recipients screens', () => {
    expect(visibleLabels('admin')).toEqual(NAV_ITEMS.map((item) => item.label))
    expect(visibleLabels('admin')).toEqual(expect.arrayContaining(['Người dùng', 'Người nhận']))
  })

  it('hides every admin-only screen from a staff member', () => {
    // "Tìm tin" (phase 6) dùng quyền xem hội thoại — nhân viên thấy, trong phạm vi nhóm của mình
    // "Bản tin" (phase 8) cũng đọc được — phạm vi DÒNG (không phải vai trò) lọc ở máy chủ
    // Thứ tự theo nhóm (27/10/2026): Tin nhắn → Theo dõi → Gửi tin → Danh bạ; Khóa MCP đã dời sang menu cá nhân
    expect(visibleLabels('staff')).toEqual(['Hội thoại', 'Tìm tin', 'Tệp', 'Việc', 'Ticket', 'Bản tin', 'Gửi tin', 'Mẫu tin', 'Danh bạ', 'Nhóm', 'Công ty'])
  })

  it('gives a manager the staff menu plus Số liệu and Danh mục — write rights do not unlock admin screens', () => {
    //  Quản lý có quyền SỬA nhóm / Danh bạ; nếu một mục admin gác nhầm bằng `group.write` thì nó sẽ lộ ra ở đây.
    const staff = visibleLabels('staff')
    const manager = visibleLabels('manager')
    expect(manager).toEqual(NAV_ITEMS.map((item) => item.label).filter((label) => staff.includes(label) || ['Số liệu', 'Danh mục NV / ĐL'].includes(label)))
    expect(manager).not.toContain('Nguồn số liệu')
  })

  it('shows Mẫu tin to staff but hides Số liệu, Danh mục and Nguồn số liệu from them', () => {
    expect(visibleLabels('staff')).toContain('Mẫu tin')
    expect(visibleLabels('staff')).not.toEqual(expect.arrayContaining(['Số liệu']))
    expect(visibleLabels('admin')).toEqual(expect.arrayContaining(['Mẫu tin', 'Số liệu', 'Danh mục NV / ĐL', 'Nguồn số liệu']))
  })

  it('shows nothing before the permission map arrives', () => {
    expect(selectVisibleNavItems(() => false)).toEqual([])
  })
})

describe('menu items point at registered screens', () => {
  it('has a menu entry for the Users and Recipients lists', () => {
    const paths = NAV_ITEMS.map((item) => item.path)
    expect(paths).toContain(appRoutes.users.list)
    expect(paths).toContain(appRoutes.recipients.list)
  })

  it('shows Khóa MCP to every role in the personal menu, not in the sidebar (each manages their own keys)', () => {
    for (const role of ['admin', 'manager', 'staff'] as const) {
      expect(selectVisibleNavItems(canFor(role), USER_MENU_ITEMS).map((item) => item.label)).toEqual(['Khóa MCP'])
      expect(visibleLabels(role)).not.toContain('Khóa MCP')
    }
    expect(ALL_NAV_ITEMS.map((item) => item.path)).toContain(appRoutes.mcpKeys.list)
  })

  it('has a menu entry for the Ticket list that staff can see (read-only)', () => {
    expect(NAV_ITEMS.find((item) => item.path === appRoutes.tickets.list)?.entity).toBe('ticket')
    expect(visibleLabels('staff')).toContain('Ticket')
  })

  it('has a menu entry for the Việc (task) list that staff can see (read-only)', () => {
    expect(NAV_ITEMS.find((item) => item.path === appRoutes.tasks.list)?.entity).toBe('task')
    expect(visibleLabels('staff')).toContain('Việc')
  })

  it('has a menu entry for the Bản tin (brief) list that staff can see (read-only, scoped by row server-side)', () => {
    expect(NAV_ITEMS.find((item) => item.path === appRoutes.briefs.list)?.entity).toBe('brief')
    expect(visibleLabels('staff')).toContain('Bản tin')
  })

  it('has a menu entry for Gửi tin (send commands) that staff can see (rows scoped to their own commands server-side)', () => {
    expect(NAV_ITEMS.find((item) => item.path === appRoutes.sendCommands.list)?.entity).toBe('send_command')
    expect(visibleLabels('staff')).toContain('Gửi tin')
  })

  it('never repeats a path — the breadcrumb picks the first prefix match', () => {
    const paths = ALL_NAV_ITEMS.map((item) => item.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('sidebar groups (27/10/2026: six collapsible groups instead of one flat list)', () => {
  it('every item belongs to a declared group and the groups keep their declared order for an admin', () => {
    const groupIds = NAV_GROUPS.map((group) => group.id)
    for (const item of NAV_ITEMS) expect(groupIds).toContain(item.group)
    expect(selectVisibleNavGroups(canFor('admin')).map((group) => group.label)).toEqual(['Tin nhắn', 'Theo dõi', 'Gửi tin', 'Số liệu', 'Danh bạ', 'Hệ thống'])
    expect(selectVisibleNavGroups(canFor('admin')).flatMap((group) => group.items.map((item) => item.label))).toEqual(NAV_ITEMS.map((item) => item.label))
  })

  it('drops a group whose every item is hidden — staff see no Số liệu and no Hệ thống heading', () => {
    expect(selectVisibleNavGroups(canFor('staff')).map((group) => group.label)).toEqual(['Tin nhắn', 'Theo dõi', 'Gửi tin', 'Danh bạ'])
    expect(selectVisibleNavGroups(canFor('manager')).map((group) => group.label)).toEqual(['Tin nhắn', 'Theo dõi', 'Gửi tin', 'Số liệu', 'Danh bạ'])
    expect(selectVisibleNavGroups(() => false)).toEqual([])
  })

  it('puts each screen under the agreed group', () => {
    const groupOf = (label: string) => navGroupLabel(NAV_ITEMS.find((item) => item.label === label))
    expect(['Hội thoại', 'Tìm tin', 'Tệp', 'Hỏi trợ lý'].map(groupOf)).toEqual(Array(4).fill('Tin nhắn'))
    expect(['Việc', 'Ticket', 'Bản tin', 'Người nhận'].map(groupOf)).toEqual(Array(4).fill('Theo dõi'))
    expect(['Gửi tin', 'Mẫu tin'].map(groupOf)).toEqual(Array(2).fill('Gửi tin'))
    expect(['Số liệu', 'Nguồn số liệu', 'Danh mục NV / ĐL'].map(groupOf)).toEqual(Array(3).fill('Số liệu'))
    expect(['Danh bạ', 'Nhóm', 'Công ty'].map(groupOf)).toEqual(Array(3).fill('Danh bạ'))
    expect(['Tài khoản bot', 'Người dùng', 'Nhập lịch sử', 'Cài đặt'].map(groupOf)).toEqual(Array(4).fill('Hệ thống'))
    expect(navGroupLabel(undefined)).toBeUndefined()
  })
})
