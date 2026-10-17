import { useQuery } from '@tanstack/react-query'

import { auditApi } from './audit-api'

/** Nhật ký thao tác của một bản ghi, mới nhất trước. */
export function useAuditLogs(entity: string, entityId: number, enabled = true) {
  return useQuery({
    queryKey: ['audit-logs', entity, entityId],
    queryFn: () => auditApi.list(entity, entityId),
    enabled: enabled && entityId > 0,
  })
}
