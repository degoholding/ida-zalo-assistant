import { describe, expect, it } from 'vitest'

import { TONE_CLASS } from '@/shared/ui/status-tone'
import { BRIEF_KIND, BRIEF_STATUS } from '../types/brief'
import { getBriefDisplayStatus, getBriefDisplayStatusLabel, getBriefDisplayStatusTone } from './get-brief-display-status'

const NOW = new Date('2026-10-09T10:00:00+07:00')

describe('getBriefDisplayStatus', () => {
  it('maps Composing / Sent / Failed straight through regardless of age', () => {
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.composing, kind: BRIEF_KIND.morning, created_at: '2020-01-01T00:00:00Z' }, NOW)).toBe('composing')
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.sent, kind: BRIEF_KIND.morning, created_at: '2020-01-01T00:00:00Z' }, NOW)).toBe('sent')
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.failed, kind: BRIEF_KIND.morning, created_at: '2020-01-01T00:00:00Z' }, NOW)).toBe('failed')
  })

  it('Queued bản tin sáng/cuối ngày (không tệp): còn trong 2 giờ thì vẫn «queued», quá 2 giờ thì «undeliverable»', () => {
    const justUnder = new Date(NOW.getTime() - (2 * 60 * 60 * 1000 - 1)).toISOString()
    const justOver = new Date(NOW.getTime() - (2 * 60 * 60 * 1000 + 1)).toISOString()
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: BRIEF_KIND.morning, created_at: justUnder }, NOW)).toBe('queued')
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: BRIEF_KIND.evening, created_at: justOver }, NOW)).toBe('undeliverable')
  })

  it('Queued báo cáo tuần/tháng (có tệp): mốc rộng hơn, 12 giờ', () => {
    const justUnder = new Date(NOW.getTime() - (12 * 60 * 60 * 1000 - 1)).toISOString()
    const justOver = new Date(NOW.getTime() - (12 * 60 * 60 * 1000 + 1)).toISOString()
    // Cùng tuổi (2 giờ 1 phút) — bản tin sáng đã «undeliverable» nhưng báo cáo tuần vẫn «queued»
    const twoHoursOneMinute = new Date(NOW.getTime() - (2 * 60 * 60 * 1000 + 60_000)).toISOString()
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: BRIEF_KIND.weekly, created_at: twoHoursOneMinute }, NOW)).toBe('queued')
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: BRIEF_KIND.weekly, created_at: justUnder }, NOW)).toBe('queued')
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: BRIEF_KIND.monthly, created_at: justOver }, NOW)).toBe('undeliverable')
  })

  it('created_at không đọc được (chuỗi rác) → không chặn màn, coi như vẫn đang chờ', () => {
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: BRIEF_KIND.morning, created_at: 'không phải ngày' }, NOW)).toBe('queued')
  })

  it('mã kind lạ (0, số âm) không khớp báo cáo tuần/tháng → vẫn dùng mốc 2 giờ ngắn hơn', () => {
    const justOver = new Date(NOW.getTime() - (2 * 60 * 60 * 1000 + 1)).toISOString()
    expect(getBriefDisplayStatus({ status: BRIEF_STATUS.queued, kind: 0, created_at: justOver }, NOW)).toBe('undeliverable')
  })
})

describe('getBriefDisplayStatusLabel / getBriefDisplayStatusTone', () => {
  it('gives every display status its own colour, and each colour exists in the shared palette', () => {
    const statuses = ['composing', 'queued', 'sent', 'failed', 'undeliverable'] as const
    const tones = statuses.map(getBriefDisplayStatusTone)
    expect(new Set(tones).size).toBe(tones.length)
    for (const tone of tones) expect(TONE_CLASS[tone]).toBeTruthy()
    expect(getBriefDisplayStatusLabel('undeliverable')).toBe('Không gửi được')
    expect(getBriefDisplayStatusLabel('sent')).toBe('Đã gửi')
  })
})
