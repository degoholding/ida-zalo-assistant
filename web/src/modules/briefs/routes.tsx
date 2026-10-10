import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const briefsModule: RouteObject[] = [
  {
    path: appRoutes.briefs.list,
    lazy: async () => ({ Component: (await import('./pages/brief-list-page')).BriefListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.briefs.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/brief-detail-page')).BriefDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
