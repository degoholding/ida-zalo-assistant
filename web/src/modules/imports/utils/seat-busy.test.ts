import { describe, expect, it } from 'vitest'

import type { SeatInfo, SeatJob } from '../types/import'
import { isSeatBusy } from './seat-busy'

const job = (stage: SeatJob['stage']): SeatJob => ({
  stage, percent: 0, note: null, error: null, conversations: null, files: null, media: null, messages: null, started_at: null, finished_at: null, updated_at: null,
})
const seat = (phase: string, extra: Partial<NonNullable<SeatInfo['status']>> = {}): SeatInfo => ({
  configured: true, reachable: true,
  status: { phase, user: null, linked_account: null, conversations: 0, last_qr_at: 0, sync: null, job: null, ...extra },
})

describe('isSeatBusy', () => {
  it('ghế tắt hay đang chờ QR thì không bận', () => {
    expect(isSeatBusy(undefined)).toBe(false)
    expect(isSeatBusy({ configured: true, reachable: false })).toBe(false)
    expect(isSeatBusy(seat('login: chờ quét QR'))).toBe(false)
  })
  it('việc sync-once ở sync / export / import là bận; done / error / login thì không', () => {
    for (const stage of ['sync', 'export', 'import'] as const) expect(isSeatBusy(seat('main', { job: job(stage) }))).toBe(true)
    for (const stage of ['done', 'error', 'login'] as const) expect(isSeatBusy(seat('main', { job: job(stage) }))).toBe(false)
  })
  it('không có việc sync-once thì theo cờ sync của cổng', () => {
    const sync = { ready: true, running: true, progress: 10, last_result: null, started_at: 1, finished_at: null }
    expect(isSeatBusy(seat('main', { sync }))).toBe(true)
    expect(isSeatBusy(seat('main', { sync: { ...sync, running: false } }))).toBe(false)
  })
})
