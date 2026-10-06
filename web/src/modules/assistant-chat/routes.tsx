import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const assistantChatModule: RouteObject[] = [
  {
    path: appRoutes.assistantChat,
    lazy: async () => ({ Component: (await import('./pages/assistant-chat-page')).AssistantChatPage }),
    errorElement: <RouteErrorPage />,
  },
]
