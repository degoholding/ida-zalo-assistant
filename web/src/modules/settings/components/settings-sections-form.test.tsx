import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyRound } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsSectionsForm } from './settings-sections-form'
import type { SettingView } from '../types/setting'

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  extractErrorMessage: () => 'Có lỗi xảy ra',
}))

const MODEL: SettingView = {
  key: 'gemini_model', group: 'assistant', label: 'Mô hình chính', help: 'Mô hình trả lời.', type: 'string',
  secret: false, value: 'gemini-3.5-flash-lite', is_set: true, hint: '', source: 'default', env_value: null,
  default_value: 'gemini-3.5-flash-lite', min: null, max: null, max_length: 200, allow_empty: false,
}
const SECTIONS = [{ id: 'ai', title: 'Khóa & mô hình AI', description: 'Mô tả', icon: KeyRound, keys: ['gemini_model'] }]

function renderForm(extras?: Record<string, React.ReactNode>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsSectionsForm settings={[MODEL]} sections={SECTIONS} extras={extras} />
    </QueryClientProvider>,
  )
}

describe('SettingsSectionsForm', () => {
  it('counts unsaved changes in the sticky bar and discards them on «Hoàn tác»', async () => {
    renderForm()
    expect(screen.getByText('Không có thay đổi chưa lưu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lưu thay đổi/ })).toBeDisabled()

    const input = screen.getByLabelText('Mô hình chính')
    await userEvent.clear(input)
    await userEvent.type(input, 'gemini-pro')
    expect(await screen.findByText('1 thay đổi chưa lưu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lưu thay đổi/ })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: /Hoàn tác/ }))
    expect(await screen.findByText('Không có thay đổi chưa lưu')).toBeInTheDocument()
    expect(input).toHaveValue('gemini-3.5-flash-lite')
  })

  it('renders the section heading and the extra block under its own section', () => {
    renderForm({ ai: <p>Khối kết nối</p> })
    expect(screen.getByText('Khóa & mô hình AI')).toBeInTheDocument()
    expect(screen.getByText('Khối kết nối')).toBeInTheDocument()
  })
})
