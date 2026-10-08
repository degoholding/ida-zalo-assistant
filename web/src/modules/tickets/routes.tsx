import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const ticketsModule: RouteObject[] = [
  {
    path: appRoutes.tickets.list,
    lazy: async () => ({ Component: (await import('./pages/ticket-list-page')).TicketListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.tickets.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/ticket-detail-page')).TicketDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
