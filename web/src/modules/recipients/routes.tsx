import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const recipientsModule: RouteObject[] = [
  {
    path: appRoutes.recipients.list,
    lazy: async () => ({ Component: (await import('./pages/recipient-list-page')).RecipientListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    //  Route TĨNH trỏ vào cùng trang chi tiết — `CrudDetailPage` không thấy `:id` thì tự sang chế độ thêm mới.
    path: appRoutes.recipients.create,
    lazy: async () => ({ Component: (await import('./pages/recipient-detail-page')).RecipientDetailPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.recipients.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/recipient-detail-page')).RecipientDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
