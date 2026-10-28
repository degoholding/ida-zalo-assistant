import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { usePermission } from '@/core/authorization/use-permission'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { McpUsageFilters } from '../components/mcp-usage-filters'
import { McpUsageDailyTable, McpUsageToolTable, McpUsageTotals } from '../components/mcp-usage-tables'
import { useMcpUsage } from '../hooks/use-mcp-usage'
import type { McpUsageQuery } from '../types/mcp-usage'

/** Màn Thống kê dùng MCP (phase 13.6) — CHỈ quản trị: tải + chi phí khi sếp hỏi qua cổng MCP, đọc từ nhật ký gọi công cụ. */
export function McpUsagePage() {
  const { can } = usePermission()
  // Quản trị = người có quyền sửa cài đặt — khớp luật mặc định của route-permissions ở máy chủ
  const isAdmin = can('setting', 'write')
  const [query, setQuery] = useState<McpUsageQuery>({ days: 7, group: 'key', source: 'http' })
  const usage = useMcpUsage(query, isAdmin)

  return (
    <PageContainer>
      <PageHeader
        leading={
          <Button variant="ghost" size="icon" asChild aria-label="Quay lại Khóa MCP">
            <Link to={appRoutes.mcpKeys.list}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        }
        title="Thống kê dùng MCP"
        description="Số lượt AI ngoài gọi công cụ, lỗi, thời gian trả lời và lượng dữ liệu trả ra theo từng ngày — để theo dõi tải máy chủ và chi phí token."
      />
      {!isAdmin ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Chỉ quản trị xem được thống kê này.</p>
      ) : (
        <div className="space-y-4">
          <McpUsageFilters query={query} onChange={(patch) => setQuery({ ...query, ...patch })} />
          {usage.isError && <p className="text-sm text-destructive">Không tải được thống kê — thử lại sau.</p>}
          {usage.isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
          {usage.data && (
            <>
              <McpUsageTotals totals={usage.data.totals} />
              <McpUsageDailyTable usage={usage.data} groupBy={usage.data.group_by} />
              <McpUsageToolTable usage={usage.data} />
            </>
          )}
        </div>
      )}
    </PageContainer>
  )
}
