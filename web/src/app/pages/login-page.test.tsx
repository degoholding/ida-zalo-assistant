import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth/auth-store'
import { LoginPage } from './login-page'

const apiGet = vi.fn()
const apiPost = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  queryClient: { clear: vi.fn() },
  extractErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Có lỗi xảy ra'),
}))

//  Nút thật của Google tải script bên thứ ba và vẽ trong iframe — jsdom không chạy được. Thay bằng một nút trả về
//  đúng thứ Google trả (`credential` = ID token) để kiểm phần CỦA TA: hiện nút khi nào, gửi gì lên máy chủ.
const googleCredential = { current: 'google-id-token' as string | undefined }
vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children, clientId }: { children: ReactNode; clientId: string }) => (
    <div data-client-id={clientId}>{children}</div>
  ),
  GoogleLogin: ({ onSuccess }: { onSuccess: (response: { credential?: string }) => void }) => (
    <button type="button" onClick={() => onSuccess({ credential: googleCredential.current })}>
      Đăng nhập bằng Google
    </button>
  ),
}))

const SIGNED_IN_USER = {
  id: 5,
  full_name: 'Chị Lan',
  email: 'lan@ida.vn',
  role: 3,
  all_groups: false,
  permissions: {},
}

function mockAuthConfig(config: { google_client_id: string } | Error) {
  apiGet.mockImplementation((url: string) => {
    if (url !== '/api/auth/config') return Promise.reject(new Error(`không mong gọi ${url}`))
    return config instanceof Error ? Promise.reject(config) : Promise.resolve(config)
  })
}

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Trang chủ</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  googleCredential.current = 'google-id-token'
  useAuthStore.setState({ user: null, status: 'signed-out', isLoggingIn: false })
})

describe('LoginPage', () => {
  it('sends the typed username (trimmed) together with the password', async () => {
    mockAuthConfig({ google_client_id: '' })
    apiPost.mockResolvedValueOnce({ user: { id: 1, full_name: 'Quản trị', email: '', role: 1, all_groups: true, permissions: {} } })
    renderLogin()

    const submit = screen.getByRole('button', { name: 'Đăng nhập' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Tên đăng nhập hoặc email'), { target: { value: '  admin ' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'admin' } })
    fireEvent.click(submit)

    await vi.waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/auth/login', { username: 'admin', password: 'admin' }, expect.anything()))
  })

  it('shows the Google button only after the server returns a client id', async () => {
    mockAuthConfig({ google_client_id: 'abc.apps.googleusercontent.com' })
    renderLogin()

    expect(await screen.findByRole('button', { name: 'Đăng nhập bằng Google' })).toBeInTheDocument()
    // Đăng nhập bằng tên + mật khẩu vẫn còn bên cạnh nút Google
    expect(screen.getByLabelText('Tên đăng nhập hoặc email')).toBeInTheDocument()
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument()
  })

  it('hides the Google button when the client id is empty or only whitespace', async () => {
    mockAuthConfig({ google_client_id: '   ' })
    renderLogin()

    await vi.waitFor(() => expect(apiGet).toHaveBeenCalledWith('/api/auth/config'))
    expect(screen.queryByRole('button', { name: 'Đăng nhập bằng Google' })).toBeNull()
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument()
  })

  it('keeps password login usable when the config request fails', async () => {
    mockAuthConfig(new Error('mạng lỗi'))
    renderLogin()

    await vi.waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Đăng nhập bằng Google' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument()
  })

  it('posts the Google credential and lands on the page the user came for, like password login', async () => {
    mockAuthConfig({ google_client_id: 'abc' })
    apiPost.mockResolvedValue({ user: SIGNED_IN_USER })
    renderLogin()

    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Google' }))

    expect(apiPost).toHaveBeenCalledWith('/api/auth/google', { credential: 'google-id-token' }, expect.anything())
    expect(await screen.findByText('Trang chủ')).toBeInTheDocument()
    expect(useAuthStore.getState().user?.email).toBe('lan@ida.vn')
  })

  it('shows the server message verbatim when the email is not allowed in', async () => {
    mockAuthConfig({ google_client_id: 'abc' })
    apiPost.mockRejectedValue(new Error('Email lan@gmail.com chưa được cấp quyền vào Bot trợ lý — nhờ quản trị thêm ở màn Người dùng.'))
    renderLogin()

    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Google' }))

    expect(await screen.findByText(/chưa được cấp quyền vào Bot trợ lý/)).toBeInTheDocument()
    expect(screen.queryByText('Trang chủ')).toBeNull()
    expect(useAuthStore.getState().status).toBe('signed-out')
  })

  it('does not call the server when Google returns no credential', async () => {
    mockAuthConfig({ google_client_id: 'abc' })
    googleCredential.current = undefined
    renderLogin()

    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Google' }))

    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.getByText(/Google không trả về thông tin đăng nhập/)).toBeInTheDocument()
  })
})
