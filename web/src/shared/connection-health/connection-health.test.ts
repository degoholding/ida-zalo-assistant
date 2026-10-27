import { describe, expect, it } from 'vitest'

import { assessConnectionHealth, describeGoogle, describeZalo, type BotAccountHealth, type GoogleHealthStatus } from './connection-health'

const base: GoogleHealthStatus = {
  client_configured: true,
  connected: true,
  email: 'bot@gmail.com',
  days_left: 3.2,
  expired: false,
  refresh_error: '',
  health: 'ok',
}

const account = (over: Partial<BotAccountHealth>): BotAccountHealth => ({
  id: 1, label: 'Bot Lạc Lạc', is_active: true, state: 'listening', state_label: 'Đang nghe', ...over,
})

describe('describeGoogle', () => {
  it('is grey while loading and when Google is not in use or not connected yet — no warning', () => {
    expect(describeGoogle(undefined)).toEqual({ dot: 'grey', label: 'Google: đang kiểm…', warning: '' })
    expect(describeGoogle({ ...base, connected: false, client_configured: false, health: 'disconnected' }).label).toBe('Google: chưa dùng')
    const notYet = describeGoogle({ ...base, connected: false, health: 'disconnected' })
    expect(notYet).toEqual({ dot: 'grey', label: 'Google: chưa kết nối', warning: '' })
  })

  it('is green with the days left while the 7-day token is fresh', () => {
    expect(describeGoogle(base)).toEqual({ dot: 'green', label: 'Google: còn 3 ngày', warning: '' })
    // Kết nối từ trước 27/10 không có lúc đồng ý: vẫn xanh, chỉ ghi email
    expect(describeGoogle({ ...base, days_left: null }).label).toBe('Google: đã kết nối (bot@gmail.com)')
  })

  it('turns red with a warning under one day and when expired or refused by Google', () => {
    const soon = describeGoogle({ ...base, days_left: 0.5, health: 'expiring' })
    expect(soon.dot).toBe('red')
    expect(soon.label).toBe('Google: hết hạn trong 12 giờ')
    expect(soon.warning).toContain('12 giờ')

    const gone = describeGoogle({ ...base, days_left: -1, expired: true, health: 'expired' })
    expect(gone).toMatchObject({ dot: 'red', label: 'Google: HẾT HẠN' })
    expect(gone.warning).toContain('quá 7 ngày')

    const refused = describeGoogle({ ...base, expired: true, health: 'expired', refresh_error: 'Kết nối Google đã hết hạn hoặc bị thu hồi' })
    expect(refused.warning).toContain('Google đã từ chối kết nối')
  })
})

describe('describeGoogle in production mode (GOOGLE_OAUTH_TESTING=false)', () => {
  it('has no day count and only turns red when Google refuses the token', () => {
    const prod = { ...base, oauth_testing: false, days_left: null }
    expect(describeGoogle(prod)).toEqual({ dot: 'green', label: 'Google: đã kết nối (bot@gmail.com)', warning: '' })
    const refused = describeGoogle({ ...prod, expired: true, health: 'expired' })
    expect(refused.dot).toBe('red')
    expect(refused.warning).toContain('Google đã từ chối kết nối')
    expect(refused.warning).not.toContain('7 ngày')
  })
})

describe('describeZalo', () => {
  it('skips switched-off accounts and colours the rest by session state', () => {
    const dots = describeZalo([
      account({ id: 1 }),
      account({ id: 2, label: 'Bot kho', state: 'needs_login', state_label: 'Hết phiên — cần quét QR lại' }),
      account({ id: 3, label: 'Bot cũ', is_active: false, state: 'off', state_label: 'Đã tắt' }),
      account({ id: 4, label: 'Bot thử', state: 'stopped', state_label: 'Không chạy' }),
      account({ id: 5, label: 'Bot nối', state: 'reconnecting', state_label: 'Đang nối lại' }),
    ])
    expect(dots.map((d) => [d.id, d.dot, d.label])).toEqual([
      [1, 'green', 'Bot Lạc Lạc: đang nghe'],
      [2, 'red', 'Bot kho: cần quét QR'],
      [4, 'red', 'Bot thử: Không chạy'],
      [5, 'grey', 'Bot nối: đang nối lại'],
    ])
    expect(dots[1].warning).toContain('quét QR')
    expect(dots[2].warning).toContain('không chạy')
    expect(dots[0].warning).toBe('')
  })

  it('returns nothing before the account list arrives', () => {
    expect(describeZalo(undefined)).toEqual([])
  })
})

describe('assessConnectionHealth', () => {
  it('collects only the warnings that need the banner', () => {
    const fine = assessConnectionHealth(base, [account({})])
    expect(fine.warnings).toEqual([])
    const bad = assessConnectionHealth({ ...base, expired: true, health: 'expired' }, [account({ state: 'needs_login', state_label: 'Hết phiên' })])
    expect(bad.warnings).toHaveLength(2)
    expect(bad.google.dot).toBe('red')
    expect(bad.zalo[0].dot).toBe('red')
  })
})
