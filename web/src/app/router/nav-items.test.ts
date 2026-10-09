import { describe, expect, it } from 'vitest'

import { ENTITIES, type PermissionAction, type PermissionEntity } from '@/core/authorization/permission-types'
import { appRoutes } from '@/shared/constants/app-routes'
import { NAV_ITEMS, selectVisibleNavItems } from './nav-items'

/**
 * Ma trận quyền CHÉP TAY từ `permissionsFor` ở máy chủ (`src/auth/principal.ts`) — đổi bên đó thì sửa ở đây.
 * Bài này chốt chuyện: người không phải quản trị KHÔNG thấy mục menu mà bấm vào chỉ ăn 403
 * (Hỏi trợ lý, Nhập lịch sử, Cài đặt, Tài khoản bot, Người dùng, Người nhận).
 */
const ADMIN_ONLY: PermissionEntity[] = ['bot_account', 'setting', 'user', 'recipient', 'audit']

function buildPermissions(role: 'admin' | 'manager' | 'staff') {
  return Object.fromEntries(
    ENTITIES.map((entity) => {
      if (role === 'admin') return [entity, { read: true, write: true, export: true, create: true }]
      if (ADMIN_ONLY.includes(entity)) return [entity, { read: false, write: false, export: false, create: false }]
      const canWrite = role === 'manager' && ['conversation', 'contact', 'group', 'file', 'ticket', 'task'].includes(entity)
      return [entity, { read: true, write: canWrite, export: role === 'manager', create: false }]
    }),
  ) as Record<string, Record<string, boolean>>
}

function visibleLabels(role: 'admin' | 'manager' | 'staff') {
  const permissions = buildPermissions(role)
  const can = (entity: PermissionEntity, action: PermissionAction) => Boolean(permissions[entity]?.[action])
  return selectVisibleNavItems(can).map((item) => item.label)
}

describe('sidebar gating by role', () => {
  it('shows an admin every menu item, including the new Users and Recipients screens', () => {
    expect(visibleLabels('admin')).toEqual(NAV_ITEMS.map((item) => item.label))
    expect(visibleLabels('admin')).toEqual(expect.arrayContaining(['Người dùng', 'Người nhận']))
  })

  it('hides every admin-only screen from a staff member', () => {
    // «Tìm tin» (phase 6) dùng quyền xem hội thoại — nhân viên thấy, trong phạm vi nhóm của mình
    expect(visibleLabels('staff')).toEqual(['Hội thoại', 'Tìm tin', 'Danh bạ', 'Nhóm', 'Tệp', 'Ticket', 'Việc', 'Công ty'])
  })

  it('gives a manager the same menu as staff — write rights do not unlock admin screens', () => {
    //  Quản lý có quyền SỬA nhóm / Danh bạ; nếu một mục admin gác nhầm bằng `group.write` thì nó sẽ lộ ra ở đây.
    expect(visibleLabels('manager')).toEqual(visibleLabels('staff'))
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

  it('has a menu entry for the Ticket list that staff can see (read-only)', () => {
    expect(NAV_ITEMS.find((item) => item.path === appRoutes.tickets.list)?.entity).toBe('ticket')
    expect(visibleLabels('staff')).toContain('Ticket')
  })

  it('has a menu entry for the Việc (task) list that staff can see (read-only)', () => {
    expect(NAV_ITEMS.find((item) => item.path === appRoutes.tasks.list)?.entity).toBe('task')
    expect(visibleLabels('staff')).toContain('Việc')
  })

  it('never repeats a path — the breadcrumb picks the first prefix match', () => {
    const paths = NAV_ITEMS.map((item) => item.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
