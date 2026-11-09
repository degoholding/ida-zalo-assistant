import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const importsModule: RouteObject[] = [
  {
    path: appRoutes.imports.zaloWeb,
    lazy: async () => ({ Component: (await import('./pages/history-import-page')).HistoryImportPage }),
    errorElement: <RouteErrorPage />,
  },
]
