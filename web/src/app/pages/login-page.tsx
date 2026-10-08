//  Nút Google dùng `@react-oauth/google` — cùng thư viện và cùng khuôn với màn đăng nhập ERP v2; shadcn không có.
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { extractErrorMessage } from '@/core/api'
import { authService } from '@/core/auth/auth-service'
import { useAuthStore } from '@/core/auth/auth-store'
import { env } from '@/core/config/env'
import { appRoutes } from '@/shared/constants/app-routes'
import { queryKeys } from '@/shared/constants/query-keys'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

/**
 * Đăng nhập khu quản trị.
 *
 * Đường chính: nút «Đăng nhập bằng Google» — người dùng có email trong màn Người dùng. Client ID đọc từ máy chủ lúc
 * chạy (`/api/auth/config`), không nướng vào bản build: quản trị đổi ô «Đăng nhập Google» ở Cài đặt là có hiệu lực,
 * không phải build lại giao diện. Rỗng = máy chủ chưa bật → ẩn hẳn nút (dựng nút với Client ID rỗng thì Google
 * Identity Services báo lỗi liên tục).
 *
 * Đường dự phòng: mật khẩu quản trị (ADMIN_PASSWORD của máy chủ) — giữ nguyên như trước.
 */
export function LoginPage() {
  const status = useAuthStore((s) => s.status)
  const login = useAuthStore((s) => s.login)
  const loginGoogle = useAuthStore((s) => s.loginGoogle)
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? appRoutes.launcher

  //  Lỗi khi hỏi cấu hình thì coi như chưa bật Google — mật khẩu quản trị vẫn dùng được.
  const { data: authConfig } = useQuery({
    queryKey: queryKeys.auth.config(),
    queryFn: authService.config,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const googleClientId = authConfig?.google_client_id?.trim() ?? ''

  if (status === 'signed-in') return <Navigate to={from} replace />

  const runLogin = async (attempt: () => Promise<void>) => {
    setError('')
    try {
      await attempt()
      navigate(from, { replace: true })
    } catch (err) {
      //  401/403 của máy chủ mang sẵn câu tiếng Việt («Email … chưa được cấp quyền…») — hiện nguyên văn.
      setError(extractErrorMessage(err))
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void runLogin(() => login({ password }))
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <Card className="w-full max-w-sm gap-4 p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-navy">{env.appName}</h1>
            <p className="text-sm text-muted-foreground">Đăng nhập khu quản trị</p>
          </div>
        </div>

        {googleClientId && (
          //  Provider đặt ngay trong màn đăng nhập (không ở gốc app) để các màn khác khỏi tải script bên thứ ba.
          <GoogleOAuthProvider clientId={googleClientId}>
            <div className="flex flex-col items-center gap-2">
              <GoogleLogin
                text="signin_with"
                locale="vi"
                onSuccess={(response) => {
                  if (response.credential) void runLogin(() => loginGoogle(response.credential ?? ''))
                  else setError('Google không trả về thông tin đăng nhập — thử lại.')
                }}
                onError={() => setError('Đăng nhập Google bị lỗi hoặc bị hủy.')}
              />
              <p className="text-center text-xs text-muted-foreground">
                Dùng đúng email đã được quản trị thêm ở màn Người dùng.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium text-muted-foreground">hoặc mật khẩu quản trị</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </GoogleOAuthProvider>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Mật khẩu quản trị</Label>
            <Input
              id="password"
              type="password"
              autoFocus={!googleClientId}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {googleClientId && (
              <p className="text-xs text-muted-foreground">Đường dự phòng cho quản trị khi chưa đăng nhập Google được.</p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant={googleClientId ? 'outline' : 'default'} disabled={isLoggingIn || !password}>
            Đăng nhập
          </Button>
        </form>
      </Card>
    </div>
  )
}
