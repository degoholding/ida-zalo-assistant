import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const mcpKeysModule: RouteObject[] = [
  {
    path: appRoutes.mcpKeys.list,
    lazy: async () => ({ Component: (await import('./pages/mcp-key-list-page')).McpKeyListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    // Đường tĩnh — react-router xếp trên `:id` của chi tiết
    path: appRoutes.mcpKeys.usage,
    lazy: async () => ({ Component: (await import('./pages/mcp-usage-page')).McpUsagePage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.mcpKeys.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/mcp-key-detail-page')).McpKeyDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
