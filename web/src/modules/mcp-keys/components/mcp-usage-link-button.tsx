import { BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'

/** Nút mở màn Thống kê dùng MCP — chỉ quản trị thấy (`isAdmin` lấy từ /api/mcp-keys/options; máy chủ vẫn tự chặn). */
export function McpUsageLinkButton({ isAdmin }: { isAdmin: boolean }) {
  if (!isAdmin) return null
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={appRoutes.mcpKeys.usage}>
        <BarChart3 className="size-4" />
        Thống kê dùng
      </Link>
    </Button>
  )
}
