import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

export const usersModule: RouteObject[] = [
  {
    path: appRoutes.users.list,
    lazy: async () => ({ Component: (await import('./pages/user-list-page')).UserListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    //  Route TĨNH trỏ vào cùng trang chi tiết — `CrudDetailPage` không thấy `:id` thì tự sang chế độ thêm mới.
    path: appRoutes.users.create,
    lazy: async () => ({ Component: (await import('./pages/user-detail-page')).UserDetailPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.users.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/user-detail-page')).UserDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
