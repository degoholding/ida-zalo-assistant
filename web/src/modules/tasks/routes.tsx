import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const tasksModule: RouteObject[] = [
  {
    path: appRoutes.tasks.list,
    lazy: async () => ({ Component: (await import('./pages/task-list-page')).TaskListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.tasks.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/task-detail-page')).TaskDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
