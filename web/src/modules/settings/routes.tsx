import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const settingsModule: RouteObject[] = [
  {
    path: appRoutes.settings,
    lazy: async () => ({ Component: (await import('./pages/settings-page')).SettingsPage }),
    errorElement: <RouteErrorPage />,
  },
]
