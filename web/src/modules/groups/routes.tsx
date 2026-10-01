import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const groupsModule: RouteObject[] = [
  {
    path: appRoutes.groups.list,
    lazy: async () => ({ Component: (await import('./pages/group-list-page')).GroupListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.groups.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/group-detail-page')).GroupDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
