import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const messageSearchModule: RouteObject[] = [
  {
    path: appRoutes.search.messages,
    lazy: async () => ({ Component: (await import('./pages/message-search-page')).MessageSearchPage }),
    errorElement: <RouteErrorPage />,
  },
]
