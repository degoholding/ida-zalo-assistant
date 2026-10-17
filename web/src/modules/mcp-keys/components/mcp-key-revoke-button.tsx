import { Ban, Loader2 } from 'lucide-react'

import { PermissionGate } from '@/core/authorization/permission-gate'
import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { useMcpKeyRevoke } from '../hooks/use-mcp-key-actions'
import type { McpKeyDetail } from '../types/mcp-key'

/** «Thu hồi» ở hàng nút dính của trang chi tiết — hỏi xác nhận vì client đang dùng khóa này sẽ bị 401 ngay. Khóa đã thu hồi thì ẩn. */
export function McpKeyRevokeButton({ mcpKey }: { mcpKey: McpKeyDetail }) {
  const revoke = useMcpKeyRevoke()
  if (mcpKey.revoked_at) return null

  async function handleClick() {
    const accepted = await confirm({
      title: 'Thu hồi khóa MCP',
      message: `Thu hồi khóa «${mcpKey.name}»? Mọi client đang dùng khóa này sẽ bị từ chối ngay và không khôi phục được.`,
      confirmLabel: 'Thu hồi',
    })
    if (accepted) revoke.mutate(mcpKey.id)
  }

  return (
    <PermissionGate entity="mcp_key" action="write">
      <Button type="button" variant="outline" size="sm" disabled={revoke.isPending} onClick={() => void handleClick()}>
        {revoke.isPending ? <Loader2 className="animate-spin" /> : <Ban />}
        Thu hồi
      </Button>
    </PermissionGate>
  )
}
