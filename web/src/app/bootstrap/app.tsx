import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'

import { AppProviders } from '@/app/providers/app-providers'
import { router } from '@/app/router/app-router'
import { useAuthStore } from '@/core/auth/auth-store'
import { ErrorBoundary } from '@/shared/ui/error-boundary'

/** Gốc ứng dụng: boundary ngoài cùng, rồi provider, rồi router (như ERP v2). Mở app là hỏi phiên ngay. */
export function App() {
  const checkSession = useAuthStore((s) => s.checkSession)
  useEffect(() => {
    void checkSession()
  }, [checkSession])

  return (
    <ErrorBoundary fullScreen>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  )
}
