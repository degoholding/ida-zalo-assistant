import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

/** Cùng một trang cho cả hai đường: chưa chọn cuộc nào, và đang mở cuộc `:id`. */
export const conversationsModule: RouteObject[] = [
  {
    path: appRoutes.conversations.list,
    lazy: async () => ({ Component: (await import('./pages/conversation-page')).ConversationPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.conversations.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/conversation-page')).ConversationPage }),
    errorElement: <RouteErrorPage />,
  },
]
