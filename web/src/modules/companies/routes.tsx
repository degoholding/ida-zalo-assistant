import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const companiesModule: RouteObject[] = [
  {
    path: appRoutes.companies.list,
    lazy: async () => ({ Component: (await import('./pages/company-list-page')).CompanyListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.companies.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/company-detail-page')).CompanyDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
