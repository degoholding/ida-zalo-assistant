import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const accountsModule: RouteObject[] = [
  {
    path: appRoutes.accounts.list,
    lazy: async () => ({ Component: (await import('./pages/account-list-page')).AccountListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.accounts.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/account-detail-page')).AccountDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
