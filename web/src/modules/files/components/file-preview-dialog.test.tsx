import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { FILE_STATUS, type FileRecord } from '../types/file'
import { FileNameCell } from './file-name-cell'

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — hộp «Xem chữ» gọi apiGet.
vi.mock('@/core/api', () => ({
  httpClient: { patch: vi.fn(), post: vi.fn() },
  apiGet: vi.fn(() => new Promise(() => undefined)),
  extractErrorMessage: () => 'lỗi',
}))

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: 8, file_name: '', file_ext: '', status: FILE_STATUS.stored, keep_file: false, stored_bytes: 52_000, declared_size: null, size: 52_000,
    last_error: '', attempts: 1, stored_at: '2026-10-01T00:00:00Z', message_id: 777, sent_at: '2026-10-01T02:30:00Z', sender_name: 'Chị Lan',
    sender_uid: 'u1', sender_avatar_url: null, sender_contact_id: null, zalo_msg_type: 'chat.photo', message_kind: 1, thread_id: 3,
    thread_type: 1, thread_name: 'Ban giám đốc', download_url: '/api/files/8/download', can_retry: false, text_chars: null, text_summary: null,
    ...overrides,
  }
}

function renderCell(file: FileRecord) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FileNameCell file={file} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FileNameCell / FilePreviewDialog', () => {
  // Lỗi 08/10/2026: ảnh chat.photo không tên hiện «(chat.photo)» và bấm tên thì tải về tệp .bin thay vì xem ảnh
  it('opens a nameless chat photo as an inline picture with download and jump-to-message buttons', async () => {
    renderCell(makeFile())

    await userEvent.click(screen.getByRole('button', { name: 'Hình ảnh' }))

    const dialog = screen.getByRole('dialog')
    const image = within(dialog).getByRole('img', { name: 'Hình ảnh' })
    expect(image).toHaveAttribute('src', '/api/files/8/download?inline=1')
    expect(within(dialog).getByRole('link', { name: /Tải về/ })).toHaveAttribute('href', '/api/files/8/download')
    expect(within(dialog).getByRole('link', { name: /Xem trong hội thoại/ })).toHaveAttribute('href', '/conversations/3?msg=777')
    // Ảnh thì không bày bảng thông tin
    expect(within(dialog).queryByText('Người gửi')).toBeNull()
  })

  it('treats a png file sent as a document as an image too', async () => {
    renderCell(makeFile({ file_name: 'so-do.PNG', file_ext: '', message_kind: 2, zalo_msg_type: 'share.file' }))
    await userEvent.click(screen.getByRole('button', { name: 'so-do.PNG' }))
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/api/files/8/download?inline=1')
  })

  it('shows file info, the text summary and «Xem chữ» for a document that was read', async () => {
    renderCell(makeFile({ file_name: 'bao-gia.xlsx', file_ext: 'xlsx', message_kind: 2, zalo_msg_type: 'share.file', text_chars: 1234, text_summary: 'bảng 2 trang tính' }))

    await userEvent.click(screen.getByRole('button', { name: 'bao-gia.xlsx' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('img')).toBeNull()
    expect(within(dialog).getByText('Chị Lan')).toBeInTheDocument()
    expect(within(dialog).getByText('Ban giám đốc')).toBeInTheDocument()
    expect(within(dialog).getByText(/bảng 2 trang tính · 1\.234 ký tự/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Xem chữ/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Xem trong hội thoại/ })).toHaveAttribute('href', '/conversations/3?msg=777')
  })

  it('an image not yet in storage falls back to the info view without a download button', async () => {
    renderCell(makeFile({ status: FILE_STATUS.failed, download_url: null, last_error: 'hết hạn' }))

    await userEvent.click(screen.getByRole('button', { name: 'Hình ảnh' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('img')).toBeNull()
    expect(within(dialog).queryByRole('link', { name: /Tải về/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Xem chữ/ })).toBeNull()
    expect(within(dialog).getByText(/Chưa đọc/)).toBeInTheDocument()
    // Vẫn mở được cuộc đúng chỗ tin gửi ảnh
    expect(within(dialog).getByRole('link', { name: /Xem trong hội thoại/ })).toBeInTheDocument()
  })
})
