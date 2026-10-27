import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionHealth } from './connection-health'
import { ConnectionHealthBanner } from './connection-health-banner'

let allowed = true
let health: ConnectionHealth | null = null
const mutate = vi.fn()

vi.mock('./use-connection-health', () => ({
  useConnectionHealth: () => ({ allowed, health }),
  useStartGoogleOauthFromMenu: () => ({ mutate, isPending: false }),
}))

const fine: ConnectionHealth = {
  google: { dot: 'green', label: 'Google: còn 3 ngày', warning: '' },
  zalo: [{ id: 1, dot: 'green', label: 'Bot: đang nghe', warning: '' }],
  warnings: [],
}

const renderBanner = () =>
  render(
    <MemoryRouter>
      <ConnectionHealthBanner />
    </MemoryRouter>,
  )

beforeEach(() => {
  allowed = true
  health = fine
  mutate.mockClear()
})

describe('ConnectionHealthBanner', () => {
  it('shows nothing for non-admins, while loading, or when everything is green', () => {
    allowed = false
    renderBanner()
    expect(screen.queryByRole('alert')).toBeNull()
    allowed = true
    health = null
    renderBanner()
    expect(screen.queryByRole('alert')).toBeNull()
    health = fine
    renderBanner()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns about an expired Google link with a button that starts the Settings → Google flow', () => {
    health = {
      ...fine,
      google: { dot: 'red', label: 'Google: HẾT HẠN', warning: 'Kết nối Google đã hết hạn (đã quá 7 ngày) — bấm Kết nối Google.' },
      warnings: ['Kết nối Google đã hết hạn (đã quá 7 ngày) — bấm Kết nối Google.'],
    }
    renderBanner()
    expect(screen.getByRole('alert').textContent).toContain('Kết nối Google đã hết hạn')
    fireEvent.click(screen.getByRole('button', { name: 'Kết nối Google' }))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('links to the bot accounts screen when a Zalo session needs a new QR login', () => {
    health = {
      ...fine,
      zalo: [{ id: 2, dot: 'red', label: 'Bot kho: cần quét QR', warning: 'Tài khoản bot Bot kho hết phiên Zalo — quét QR lại.' }],
      warnings: ['Tài khoản bot Bot kho hết phiên Zalo — quét QR lại.'],
    }
    renderBanner()
    expect(screen.getByRole('link', { name: /Tài khoản bot/ }).getAttribute('href')).toBe('/accounts')
    expect(screen.queryByRole('button', { name: 'Kết nối Google' })).toBeNull()
  })
})
