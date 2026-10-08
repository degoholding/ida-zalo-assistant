import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiKeyProvider, type AiKeyItem } from '../types/ai-key'
import { AiKeyListCard } from './ai-key-list-card'

const confirmMock = vi.fn()

// Hộp xác nhận thật cần ConfirmDialogHost ở gốc app — bài kiểm chỉ cần câu trả lời có / không
vi.mock('@/shared/ui/confirm-dialog', () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
}))

const NOW = new Date('2026-10-07T08:00:00Z')

function makeItem(overrides: Partial<AiKeyItem> = {}): AiKeyItem {
  return {
    id: 1, position: 1, provider: AiKeyProvider.OpenAICompatible, provider_label: 'Tương thích OpenAI (tùy chỉnh)',
    base_url: 'https://modelapi.vn/v1', model: 'deepseek-v4.1-flash', model_heavy: '', default_model: '', key_tail: '…ab12',
    daily_cap: 0, used_today: 3, last_error: '', last_error_at: null, broken: false, allowed: true, verified_at: null, ...overrides,
  }
}

const TWO_KEYS = [
  makeItem(),
  makeItem({
    id: 7, position: 2, provider: AiKeyProvider.Gemini, provider_label: 'Gemini', base_url: '', model: '',
    default_model: 'gemini-3.5-flash-lite', key_tail: '…gm99', last_error: 'hết tiền (402)', last_error_at: '2026-10-07T07:05:00Z',
  }),
]

function renderCard(props: Partial<Parameters<typeof AiKeyListCard>[0]> = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn(),
    onMoveUp: vi.fn(),
    onRemove: vi.fn(),
  }
  render(<AiKeyListCard items={TWO_KEYS} isLoading={false} canWrite saving={false} now={NOW} {...handlers} {...props} />)
  return handlers
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AiKeyListCard', () => {
  it('lists keys numbered 1, 2 with provider, tail, station, model and the last error time', () => {
    renderCard()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('1')).toBeInTheDocument()
    expect(within(rows[0]).getByText('…ab12')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/Trạm: https:\/\/modelapi\.vn\/v1 · Mô hình: deepseek-v4\.1-flash/)).toBeInTheDocument()
    expect(within(rows[1]).getByText(/Mô hình: mặc định \(gemini-3\.5-flash-lite\)/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('Lỗi lúc 14:05: hết tiền (402)')).toBeInTheDocument()
    expect(screen.getByText(/Bot dùng khóa số 1; khóa đó hết tiền, hết hạn mức hay sai thì tự chuyển sang số 2, số 3/)).toBeInTheDocument()
  })

  it('offers "move up" only from the second key and sends that key id', async () => {
    const { onMoveUp } = renderCard()
    expect(screen.queryByRole('button', { name: 'Đưa khóa số 1 lên trước' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Đưa khóa số 2 lên trước' }))
    expect(onMoveUp).toHaveBeenCalledWith(7)
  })

  it('removes a key only after the admin confirms', async () => {
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { onRemove } = renderCard()
    const removeButtons = screen.getAllByRole('button', { name: /Gỡ khóa/ })
    await userEvent.click(removeButtons[1])
    expect(onRemove).not.toHaveBeenCalled()
    await userEvent.click(removeButtons[1])
    expect(onRemove).toHaveBeenCalledWith(7)
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('Gemini …gm99') })
  })

  it('warns that removing the very last key sends the bot back to the old settings', async () => {
    confirmMock.mockResolvedValueOnce(false)
    renderCard({ items: [makeItem()] })
    await userEvent.click(screen.getByRole('button', { name: /Gỡ khóa/ }))
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('quay về cài đặt cũ') })
  })

  it('explains the fallback to the old settings when there is no key', () => {
    renderCard({ items: [] })
    expect(screen.getByText(/Chưa có khóa nào — bot đang chạy bằng cài đặt cũ/)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('keeps "Lưu khóa" disabled until a key is pasted, then sends provider, key and options', async () => {
    const { onAdd } = renderCard()
    const save = screen.getByRole('button', { name: 'Lưu khóa' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('3. Dán khóa Gemini'), '   ')
    expect(save).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('3. Dán khóa Gemini'))
    await userEvent.type(screen.getByLabelText('3. Dán khóa Gemini'), '  AIzaSyNEWKEY0000  ')
    await userEvent.click(screen.getByRole('button', { name: 'Tùy chọn: chọn model, đặt trần lượt mỗi ngày' }))
    await userEvent.type(screen.getByLabelText('Mô hình (để trống = mặc định)'), 'gemini-3.6-flash')
    await userEvent.type(screen.getByLabelText('Trần lượt/ngày (0 = không giới hạn)'), '250')
    await userEvent.click(save)
    expect(onAdd).toHaveBeenCalledWith({
      provider: AiKeyProvider.Gemini, key: 'AIzaSyNEWKEY0000', model: 'gemini-3.6-flash', model_heavy: '', daily_cap: 250,
    })
    // Lưu xong: ô khóa xóa trắng, khóa không nằm lại trên màn hình
    expect(screen.getByLabelText('3. Dán khóa Gemini')).toHaveValue('')
  })

  it('keeps what was typed when the server rejects the key', async () => {
    const { onAdd } = renderCard()
    onAdd.mockRejectedValueOnce(new Error('OpenAI không nhận khóa này'))
    await userEvent.type(screen.getByLabelText('3. Dán khóa Gemini'), 'AIzaSyWRONG0000')
    await userEvent.keyboard('{Enter}')
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('3. Dán khóa Gemini')).toHaveValue('AIzaSyWRONG0000')
  })

  it('the key input is a password field so the key is never shown in clear text', () => {
    renderCard()
    expect(screen.getByLabelText('3. Dán khóa Gemini')).toHaveAttribute('type', 'password')
  })

  it('asks for the station address only for "Tương thích OpenAI (tùy chỉnh)" and requires it', async () => {
    const { onAdd } = renderCard()
    expect(screen.queryByLabelText('2. Địa chỉ trạm')).toBeNull()
    expect(screen.getByRole('link', { name: /Mở trang Gemini/ })).toHaveAttribute('href', 'https://aistudio.google.com/apikey')

    await userEvent.click(screen.getByRole('combobox', { name: '1. Hãng' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Tương thích OpenAI (tùy chỉnh)' }))
    const station = screen.getByLabelText('2. Địa chỉ trạm')
    await userEvent.type(screen.getByLabelText('3. Dán khóa của trạm'), 'sk-tram-0000')
    const save = screen.getByRole('button', { name: 'Lưu khóa' })
    expect(save).toBeDisabled()
    await userEvent.type(station, 'https://modelapi.vn/v1')
    await userEvent.click(save)
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ provider: AiKeyProvider.OpenAICompatible, key: 'sk-tram-0000', base_url: 'https://modelapi.vn/v1' }),
    )
  })

  it('edits model and daily cap of one key; a junk cap becomes 0 instead of NaN', async () => {
    const { onUpdate } = renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Sửa khóa số 2' }))
    await userEvent.type(screen.getByLabelText('Mô hình'), 'gemini-3.6-flash')
    await userEvent.type(screen.getByLabelText('Trần lượt/ngày'), '-5')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(onUpdate).toHaveBeenCalledWith(7, { model: 'gemini-3.6-flash', model_heavy: '', daily_cap: 0 })
  })

  it('read-only users see the list but no add box and no edit buttons', () => {
    renderCard({ canWrite: false })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText('Thêm khóa')).toBeNull()
    expect(screen.queryByRole('button', { name: /Gỡ khóa|Sửa khóa|lên trước/ })).toBeNull()
  })

  it('flags a key the server cannot decrypt', () => {
    renderCard({ items: [makeItem({ broken: true })] })
    expect(screen.getByText('Không đọc được — gỡ rồi thêm lại')).toBeInTheDocument()
  })

  it('warns on a key whose provider is not allowed, and only on that key', () => {
    renderCard({ items: [makeItem(), makeItem({ id: 7, position: 2, allowed: false, key_tail: '…gm99' })] })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).queryByText('Hãng chưa được phép — bot bỏ qua')).toBeNull()
    expect(within(rows[1]).getByText('Hãng chưa được phép — bot bỏ qua')).toBeInTheDocument()
    // Khóa bị bỏ qua vẫn phải gỡ / sửa được — không khóa nút theo cờ này
    expect(within(rows[1]).getByRole('button', { name: /Gỡ khóa/ })).toBeEnabled()
  })

  it('does not warn when the server omits the allowed flag (older server) — only an explicit false counts', () => {
    const legacy: Partial<AiKeyItem> = makeItem()
    delete legacy.allowed
    renderCard({ items: [legacy as AiKeyItem] })
    expect(screen.queryByText('Hãng chưa được phép — bot bỏ qua')).toBeNull()
  })
})
