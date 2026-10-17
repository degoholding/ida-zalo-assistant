import { useSearchParams } from 'react-router-dom'

import { usePermission } from '@/core/authorization/use-permission'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'
import { useMcpKeyOptions } from '../hooks/use-mcp-key-actions'

/** Tham số URL bật «Tất cả người dùng» — khớp `scope=all` ở `src/web/api/mcp-keys-api.ts`. */
export const MCP_KEY_SCOPE_PARAM = 'scope'
export const MCP_KEY_SCOPE_ALL = 'all'

/** Công tắc «Tất cả người dùng» — chỉ quản trị thấy; máy chủ vẫn tự khóa phạm vi, nên đây chỉ là hiển thị. */
export function McpKeyScopeToggle() {
  const { can } = usePermission()
  const { data: options } = useMcpKeyOptions(can('mcp_key', 'read'))
  const [searchParams, setSearchParams] = useSearchParams()
  if (!options?.is_admin) return null

  const checked = searchParams.get(MCP_KEY_SCOPE_PARAM) === MCP_KEY_SCOPE_ALL
  function toggle(next: boolean) {
    const params = new URLSearchParams(searchParams)
    if (next) params.set(MCP_KEY_SCOPE_PARAM, MCP_KEY_SCOPE_ALL)
    else params.delete(MCP_KEY_SCOPE_PARAM)
    setSearchParams(params)
  }

  return (
    <div className="flex items-center gap-2">
      <Switch id="mcp-key-scope-all" checked={checked} onCheckedChange={toggle} />
      <Label htmlFor="mcp-key-scope-all" className="whitespace-nowrap">Tất cả người dùng</Label>
    </div>
  )
}
