import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const replyTemplatesModule: RouteObject[] = [
  {
    path: appRoutes.replyTemplates.list,
    lazy: async () => ({ Component: (await import('./pages/reply-template-list-page')).ReplyTemplateListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.replyTemplates.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/reply-template-detail-page')).ReplyTemplateDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
