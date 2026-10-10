import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DriveRecordingFolderPanel } from './drive-recording-folder-panel'
import type { GoogleOauthStatus, SettingView } from '../types/setting'

const apiGet = vi.fn()
const apiPost = vi.fn()
let lastErrorMessage = 'Có lỗi xảy ra'

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  extractErrorMessage: () => lastErrorMessage,
}))

function makeStatus(overrides: Partial<GoogleOauthStatus>): GoogleOauthStatus {
  return {
    client_configured: true,
    connected: false,
    email: '',
    redirect_uri: 'http://localhost:8090/api/google/oauth/callback',
    drive_scope_granted: false,
    ...overrides,
  }
}

function folderSetting(isSet: boolean): SettingView {
  return {
    key: 'google_drive_recording_folder', group: 'google', label: 'Thư mục ghi âm họp (Drive)', help: '', type: 'string', secret: false,
    value: isSet ? 'abc' : '', is_set: isSet, hint: '', source: isSet ? 'web' : 'default', env_value: null, default_value: '',
    min: null, max: null, max_length: 500, allow_empty: true,
  }
}

function renderPanel(settings: SettingView[] = [folderSetting(true)]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DriveRecordingFolderPanel settings={settings} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  lastErrorMessage = 'Có lỗi xảy ra'
})

describe('DriveRecordingFolderPanel', () => {
  it('disables the test button and explains why when Google is not connected', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: false }))
    renderPanel()

    expect(await screen.findByText('Chưa có quyền đọc Drive')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /Kiểm tra thư mục/ })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Chưa kết nối Google/)).toBeInTheDocument()
  })

  it('disables the test button when connected but the Drive scope was never granted', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: true, drive_scope_granted: false }))
    renderPanel()

    await screen.findByText('Chưa có quyền đọc Drive')
    expect(screen.getByRole('button', { name: /Kiểm tra thư mục/ })).toBeDisabled()
    expect(screen.getByText(/Chưa có quyền đọc Drive — bấm/)).toBeInTheDocument()
  })

  it('disables the test button when the folder link has not been saved yet', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: true, drive_scope_granted: true, email: 'bot@gmail.com' }))
    renderPanel([folderSetting(false)])

    await screen.findByText('Đã có quyền đọc Drive: bot@gmail.com')
    expect(screen.getByRole('button', { name: /Kiểm tra thư mục/ })).toBeDisabled()
    expect(screen.getByText('Chưa có link thư mục ghi âm')).toBeInTheDocument()
  })

  it('enables the test button and shows the result once everything is in place', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: true, drive_scope_granted: true, email: 'bot@gmail.com' }))
    apiPost.mockResolvedValue({ ok: true, folder_name: 'Ghi âm họp', audio_files_7d: 3 })
    renderPanel()

    await screen.findByText('Đã có quyền đọc Drive: bot@gmail.com')
    const button = screen.getByRole('button', { name: /Kiểm tra thư mục/ })
    expect(button).not.toBeDisabled()
    await userEvent.click(button)

    expect(apiPost).toHaveBeenCalledWith('/api/settings/google/drive-test')
    expect(await screen.findByText(/Thấy thư mục "Ghi âm họp" — 3 ghi âm trong 7 ngày/)).toBeInTheDocument()
  })

  it('shows the server error message when the test call fails', async () => {
    apiGet.mockResolvedValue(makeStatus({ connected: true, drive_scope_granted: true }))
    apiPost.mockRejectedValue(new Error('lỗi'))
    lastErrorMessage = 'Không thấy thư mục này trong Drive của tài khoản đã kết nối'
    renderPanel()

    const button = await screen.findByRole('button', { name: /Kiểm tra thư mục/ })
    await userEvent.click(button)

    expect(await screen.findByText('Không thấy thư mục này trong Drive của tài khoản đã kết nối')).toBeInTheDocument()
  })
})
