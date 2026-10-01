import { Bot } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { extractErrorMessage } from '@/core/api'
import { useAuthStore } from '@/core/auth/auth-store'
import { env } from '@/core/config/env'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

/** Đăng nhập khu quản trị bằng mật khẩu quản trị (ADMIN_PASSWORD của máy chủ). */
export function LoginPage() {
  const status = useAuthStore((s) => s.status)
  const login = useAuthStore((s) => s.login)
  const isLoggingIn = useAuthStore((s) => s.isLoggingIn)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? appRoutes.launcher

  if (status === 'signed-in') return <Navigate to={from} replace />

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await login({ password })
      navigate(from, { replace: true })
    } catch (err) {
      setError(extractErrorMessage(err))
    }
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Mật khẩu quản trị</Label>
            <Input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isLoggingIn || !password}>
            Đăng nhập
          </Button>
        </form>
      </Card>
    </div>
  )
}
