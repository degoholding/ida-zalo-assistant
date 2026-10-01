import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

import { queryClient } from '@/core/api'
import { ConfirmDialogHost } from '@/shared/ui/confirm-dialog'
import { Toaster } from '@/shared/ui/sonner'
import { TooltipProvider } from '@/shared/ui/tooltip'

/**
 * Gom mọi provider toàn cục về một chỗ (giống ERP v2), thứ tự từ ngoài vào trong:
 * theme -> react-query -> nội dung. Không cần AuthProvider vì auth nằm ở zustand store.
 * Bot chưa có bảng màu theo tài khoản nên không gắn `ThemeSync` của ERP.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={150}>
          {children}
          <Toaster position="top-center" richColors closeButton />
          <ConfirmDialogHost />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
