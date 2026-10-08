import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { FILES_API_PATH } from '../api/file-api'
import { FILE_STATUS, type FileRecord } from '../types/file'
import { FileRowActions } from './file-row-actions'

const patch = vi.fn()
const post = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  httpClient: { patch: (...args: unknown[]) => patch(...args), post: (...args: unknown[]) => post(...args) },
  apiGet: vi.fn(),
  extractErrorMessage: () => 'Không có tệp này',
}))

vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) },
}))

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 42, file_name: 'bao-gia.pdf', file_ext: 'pdf', status: FILE_STATUS.stored, keep_file: false, stored_bytes: 1000,
    declared_size: 1000, size: 1000, last_error: '', attempts: 1, stored_at: '2026-10-01T00:00:00Z', message_id: 1,
    sent_at: '2026-10-01T00:00:00Z', sender_name: 'Lan', sender_uid: 'u1', sender_avatar_url: null, sender_contact_id: null,
    zalo_msg_type: 'share.file', message_kind: 1, thread_id: 3, thread_type: 1, thread_name: 'Ban giám đốc',
    download_url: '/api/files/42/download', can_retry: false, text_chars: 120, ...overrides,
  }
}

function renderActions(file: FileRecord) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <FileRowActions file={file} />
    </QueryClientProvider>,
  )
  return { invalidate }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FileRowActions', () => {
  it('marks a stored file as kept, toasts the server message and reloads the file list', async () => {
    patch.mockResolvedValue({ data: { data: makeFile({ keep_file: true }), message: 'Tệp gốc sẽ được giữ, không xóa khi hết hạn' } })
    const { invalidate } = renderActions(makeFile())

    await userEvent.click(screen.getByRole('button', { name: 'Giữ tệp gốc' }))

    expect(patch).toHaveBeenCalledWith('/api/files/42', { keep_file: true })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Tệp gốc sẽ được giữ, không xóa khi hết hạn'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getCrudRootKey(FILES_API_PATH) })
  })

  it('un-keeps an already kept file by sending keep_file false', async () => {
    patch.mockResolvedValue({ data: { data: makeFile(), message: 'Đã bỏ giữ — tệp gốc xóa theo hạn của nhóm' } })
    renderActions(makeFile({ keep_file: true }))

    expect(screen.queryByRole('button', { name: 'Giữ tệp gốc' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ giữ tệp gốc' }))

    expect(patch).toHaveBeenCalledWith('/api/files/42', { keep_file: false })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Đã bỏ giữ — tệp gốc xóa theo hạn của nhóm'))
  })

  it('shows the server error as a toast when the toggle fails', async () => {
    patch.mockRejectedValue(new Error('404'))
    renderActions(makeFile())

    await userEvent.click(screen.getByRole('button', { name: 'Giữ tệp gốc' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Không có tệp này'))
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('offers only «Xem chữ» on an expired file whose text survived — no download, no keep toggle', () => {
    renderActions(makeFile({ status: FILE_STATUS.expired, download_url: null }))

    expect(screen.getByRole('button', { name: /Xem chữ/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Giữ tệp gốc/ })).toBeNull()
    expect(screen.queryByTitle('Tải về')).toBeNull()
  })

  it('renders nothing for an expired file that was never read', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <FileRowActions file={makeFile({ status: FILE_STATUS.expired, download_url: null, text_chars: null })} />
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
