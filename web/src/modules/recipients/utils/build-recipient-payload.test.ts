import { describe, expect, it } from 'vitest'

import { buildRecipientPayload } from './build-recipient-payload'

describe('buildRecipientPayload', () => {
  it('sends VIP contact ids instead of the chip objects the form holds', () => {
    const result = buildRecipientPayload({ name: 'Anh Hùng', vips: [{ contact_id: 4, name: 'A' }, { contact_id: 9, name: 'B' }] })
    expect(result).toEqual({ name: 'Anh Hùng', vip_contact_ids: [4, 9] })
    expect(result).not.toHaveProperty('vips')
  })

  it('sends an empty VIP list when the field is empty or not an array — clearing VIPs must reach the server', () => {
    expect(buildRecipientPayload({ vips: [] }).vip_contact_ids).toEqual([])
    expect(buildRecipientPayload({ vips: '' }).vip_contact_ids).toEqual([])
    expect(buildRecipientPayload({}).vip_contact_ids).toEqual([])
  })

  it('drops duplicates and junk ids rather than letting the server reject the whole save', () => {
    const vips = [{ contact_id: 4 }, { contact_id: 4 }, { contact_id: 0 }, { contact_id: -2 }, null, { contact_id: 'x' }]
    expect(buildRecipientPayload({ vips }).vip_contact_ids).toEqual([4])
  })

  it('trims brief times but keeps an empty time as «off»', () => {
    const result = buildRecipientPayload({ morning_brief_at: ' 07:30 ', evening_brief_at: '' })
    expect(result.morning_brief_at).toBe('07:30')
    expect(result.evening_brief_at).toBe('')
  })
})
