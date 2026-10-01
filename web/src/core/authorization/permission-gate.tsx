import type { ReactNode } from 'react'

import { usePermission } from './use-permission'
import type { PermissionAction, PermissionEntity } from './permission-types'

interface PermissionGateProps {
  entity: PermissionEntity
  action: PermissionAction
  children: ReactNode
  /** Hiện thay thế khi không đủ quyền. Bỏ trống = ẩn hẳn. */
  fallback?: ReactNode
}

/**
 * Bọc quanh nút/khu vực cần quyền:
 *   <PermissionGate entity="purchase_order" action="approve"><Button…/></PermissionGate>
 */
export function PermissionGate({
  entity,
  action,
  children,
  fallback = null,
}: PermissionGateProps) {
  const { can } = usePermission()
  return <>{can(entity, action) ? children : fallback}</>
}
