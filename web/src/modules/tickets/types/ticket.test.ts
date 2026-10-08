import { describe, expect, it } from 'vitest'

import { TONE_CLASS } from '@/shared/ui/status-tone'
import {
  getTicketEventLabel,
  getTicketStatusLabel,
  getTicketStatusTone,
  isTicketOpen,
  TICKET_EVENT_KIND,
  TICKET_STATUS,
  TICKET_STATUS_OPTIONS,
} from './ticket'

describe('ticket status mapping', () => {
  it('mirrors the server TicketStatus codes 1..4 with the Vietnamese labels', () => {
    //  Chép tay từ `src/constants.ts` — lệch một số là lọc «Đang xử lý» ra ticket «Đã xong».
    expect(TICKET_STATUS).toEqual({ new: 1, inProgress: 2, done: 3, cancelled: 4 })
    expect(TICKET_STATUS_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      [1, 'Mới'],
      [2, 'Đang xử lý'],
      [3, 'Đã xong'],
      [4, 'Đã hủy'],
    ])
  })

  it('gives every status its own colour, and each colour exists in the shared palette', () => {
    const tones = TICKET_STATUS_OPTIONS.map((option) => getTicketStatusTone(option.value))
    expect(new Set(tones).size).toBe(tones.length)
    for (const tone of tones) expect(TONE_CLASS[tone]).toBeTruthy()
    expect(getTicketStatusTone(TICKET_STATUS.cancelled)).toBe('danger')
    expect(getTicketStatusTone(TICKET_STATUS.done)).toBe('done')
  })

  it('falls back to an empty label and the neutral colour for codes the UI does not know', () => {
    for (const code of [0, -1, 5, 99, Number.NaN]) {
      expect(getTicketStatusLabel(code)).toBe('')
      expect(getTicketStatusTone(code)).toBe('neutral')
    }
  })

  it('treats only New and In progress as open, like the server isOpen rule', () => {
    expect([1, 2, 3, 4, 0, 99].filter(isTicketOpen)).toEqual([1, 2])
  })
})

describe('ticket event labels', () => {
  it('labels all six server event kinds and returns empty for an unknown one', () => {
    expect(Object.values(TICKET_EVENT_KIND).map(getTicketEventLabel)).toEqual([
      'Tạo',
      'Nhận xử lý',
      'Bổ sung / nhắn',
      'Xong',
      'Hủy',
      'Mở lại',
    ])
    expect(getTicketEventLabel(0)).toBe('')
    expect(getTicketEventLabel(7)).toBe('')
  })
})
