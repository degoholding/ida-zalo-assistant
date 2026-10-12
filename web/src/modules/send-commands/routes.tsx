import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const sendCommandsModule: RouteObject[] = [
  {
    path: appRoutes.sendCommands.list,
    lazy: async () => ({ Component: (await import('./pages/send-command-list-page')).SendCommandListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.sendCommands.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/send-command-detail-page')).SendCommandDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
