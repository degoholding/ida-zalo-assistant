import { createBrowserRouter, Navigate } from 'react-router-dom'

import { AppLayout } from '@/app/layouts/app-layout'
import { LoginPage } from '@/app/pages/login-page'
import { accountsModule } from '@/modules/accounts/routes'
import { assistantChatModule } from '@/modules/assistant-chat/routes'
import { companiesModule } from '@/modules/companies/routes'
import { contactsModule } from '@/modules/contacts/routes'
import { conversationsModule } from '@/modules/conversations/routes'
import { filesModule } from '@/modules/files/routes'
import { groupsModule } from '@/modules/groups/routes'
import { importsModule } from '@/modules/imports/routes'
import { settingsModule } from '@/modules/settings/routes'
import { appRoutes } from '@/shared/constants/app-routes'
import { NotFoundPage } from '@/shared/ui/not-found-page'
import { RouteErrorPage } from '@/shared/ui/route-error-page'

/** Chỗ mà ứng dụng được phục vụ — khớp `base` của `vite.config.ts` và `serveSpa` của máy chủ. */
export const APP_BASENAME = '/app'

/** Mỗi phân hệ khai route ở `modules/<tên>/routes.tsx`; thêm phân hệ = thêm một dòng ở đây và một mục ở `nav-items.ts`. */
const MODULE_ROUTES = [
  conversationsModule,
  assistantChatModule,
  contactsModule,
  groupsModule,
  filesModule,
  importsModule,
  companiesModule,
  accountsModule,
  settingsModule,
]

/**
 * Cây route: đăng nhập công khai, còn lại nằm trong `AppLayout` (tự gác đăng nhập).
 * Hai tầng `errorElement` như ERP v2: lỗi trang con chỉ thay phần nội dung, còn menu.
 */
export const router = createBrowserRouter(
  [
    {
      errorElement: <RouteErrorPage />,
      children: [
        { path: appRoutes.login, element: <LoginPage /> },
        {
          element: <AppLayout />,
          children: [
            {
              errorElement: <RouteErrorPage />,
              children: [
                { index: true, element: <Navigate to={appRoutes.conversations.list} replace /> },
                ...MODULE_ROUTES.flat(),
                { path: '*', element: <NotFoundPage /> },
              ],
            },
          ],
        },
      ],
    },
  ],
  { basename: APP_BASENAME },
)
