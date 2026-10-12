import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BotHaltStatus } from './bot-halt-types'
import { BotHaltBanner } from './bot-halt-banner'

let status: BotHaltStatus | undefined
let role = 1

vi.mock('./use-bot-halt-status', () => ({ useBotHaltStatus: () => ({ data: status }) }))
vi.mock('@/core/auth/auth-store', () => ({
  useAuthStore: (selector: (state: { user: { role: number } }) => unknown) => selector({ user: { role } }),
}))

const renderBanner = () =>
  render(
    <MemoryRouter>
      <BotHaltBanner />
    </MemoryRouter>,
  )

beforeEach(() => {
  status = { halted: true, since: '2026-10-12T07:30:00.000Z', by: 'Chị Lan', via: 'zalo' }
  role = 1
})

describe('BotHaltBanner', () => {
  it('shows nothing while the status is unknown or the bot is running', () => {
    status = undefined
    renderBanner()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows nothing when the bot is running', () => {
    status = { halted: false, since: null, by: '', via: '' }
    renderBanner()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tells everyone since when and by whom, with a link to the Gửi tin screen only for admins', () => {
    renderBanner()
    expect(screen.getByRole('alert').textContent).toContain('Bot đang TẮT KHẨN từ 14:30 12/10 (bởi Chị Lan)')
    expect(screen.getByRole('link', { name: /Gửi tin/ }).getAttribute('href')).toBe('/send-commands')
  })

  it('hides the link from non-admins', () => {
    role = 2
    renderBanner()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('still renders when the since date or the name is missing or unreadable', () => {
    status = { halted: true, since: 'rác', by: '', via: '' }
    renderBanner()
    expect(screen.getByRole('alert').textContent).toContain('Bot đang TẮT KHẨN — không tin nào')
  })
})
