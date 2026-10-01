import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const filesModule: RouteObject[] = [
  {
    path: appRoutes.files.list,
    lazy: async () => ({ Component: (await import('./pages/file-list-page')).FileListPage }),
    errorElement: <RouteErrorPage />,
  },
]
