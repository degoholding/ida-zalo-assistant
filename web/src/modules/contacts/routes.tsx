import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

/** Route của Danh bạ — nạp lười từng trang, giống cách ERP v2 khai báo route phân hệ. */
export const contactsModule: RouteObject[] = [
  {
    path: appRoutes.contacts.list,
    lazy: async () => ({ Component: (await import('./pages/contact-list-page')).ContactListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.contacts.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/contact-detail-page')).ContactDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
