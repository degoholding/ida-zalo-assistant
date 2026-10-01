import { useCallback } from 'react'

import { useAuthStore } from '@/core/auth/auth-store'
import type { PermissionAction, PermissionEntity } from './permission-types'

/**
 * `can(entity, action)` — dùng để ẩn menu, khóa nút, ẩn cột.
 * Nhắc lại: đây là tiện ích GIAO DIỆN, không phải hàng rào bảo mật.
 */
export function usePermission() {
  const permissions = useAuthStore((s) => s.user?.permissions)

  const can = useCallback(
    (entity: PermissionEntity, action: PermissionAction) =>
      !!permissions?.[entity]?.[action],
    [permissions],
  )

  /** Có BẤT KỲ quyền nào trên entity không — dùng để quyết định hiện mục menu. */
  const canAccess = useCallback(
    (entity: PermissionEntity) => Object.values(permissions?.[entity] ?? {}).some(Boolean),
    [permissions],
  )

  return { can, canAccess }
}
