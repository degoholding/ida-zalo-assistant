import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiKeyProvider, type AiKeyItem } from '../types/ai-key'
import type { SettingView } from '../types/setting'
import { AssistantSettingsTab } from './assistant-settings-tab'

const apiGet = vi.fn()

// Mock ở tầng `@/core/api` theo luật test (`testing.md`) — không mock axios.
vi.mock('@/core/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  httpClient: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  extractErrorMessage: () => 'Có lỗi xảy ra',
}))

function makeSetting(key: string, label: string): SettingView {
  return {
    key, group: 'assistant', label, help: '', type: 'string', secret: false, value: 'x', is_set: true, hint: '',
    source: 'default', env_value: null, default_value: 'x', min: null, max: null, max_length: 200, allow_empty: true,
  }
}

const SETTINGS = [makeSetting('gemini_model', 'Gemini — mô hình chính'), makeSetting('group_trigger_keywords', 'Từ khóa gọi bot')]
const KEY: AiKeyItem = {
  id: 1, position: 1, provider: AiKeyProvider.Gemini, provider_label: 'Gemini', base_url: '', model: '', model_heavy: '',
  default_model: 'gemini-3.5-flash-lite', key_tail: '…ab12', daily_cap: 0, used_today: 0, last_error: '', last_error_at: null,
  broken: false, verified_at: null,
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AssistantSettingsTab settings={SETTINGS} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AssistantSettingsTab', () => {
  it('folds the old AI fields into «Nâng cao (cách cũ)» with an explanation once the key list has a key', async () => {
    apiGet.mockResolvedValue([KEY])
    renderTab()
    const summary = await screen.findByText(/Nâng cao \(cách cũ\)/)
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('Gemini — mô hình chính')
    expect(details).toHaveTextContent(/không có tác dụng/)
    // Ô vẫn dùng (từ khóa gọi bot) ở ngoài, không bị gập
    expect(screen.getByText('Từ khóa gọi bot').closest('details')).toBeNull()
  })

  it('keeps every field in the main form while the key list is empty — the bot still runs on the old settings', async () => {
    apiGet.mockResolvedValue([])
    renderTab()
    expect(await screen.findByText(/Dễ hơn: thêm khóa ở tab «Khóa AI»/)).toBeInTheDocument()
    expect(screen.queryByText(/Nâng cao \(cách cũ\)/)).toBeNull()
    expect(screen.getByText('Gemini — mô hình chính').closest('details')).toBeNull()
  })

  it('a key list with only undecryptable keys counts as empty, because the bot falls back to the old settings', async () => {
    apiGet.mockResolvedValue([{ ...KEY, broken: true }])
    renderTab()
    expect(await screen.findByText(/Dễ hơn: thêm khóa/)).toBeInTheDocument()
  })
})
