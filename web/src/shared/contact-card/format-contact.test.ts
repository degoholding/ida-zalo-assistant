import { describe, expect, it } from 'vitest'

import { CONTACT_KIND, GROUP_KIND } from './contact-constants'
import { getContactName, getGroupKindTone, getKindLabel, getKindTone, splitTags } from './format-contact'

describe('format-contact', () => {
  it('falls back from display name to zalo name to uid', () => {
    expect(getContactName({ display_name: 'A', zalo_name: 'B', zalo_uid: '1' })).toBe('A')
    expect(getContactName({ display_name: '', zalo_name: 'B', zalo_uid: '1' })).toBe('B')
    expect(getContactName({ display_name: '', zalo_name: '', zalo_uid: '1' })).toBe('1')
  })

  it('maps unknown kind codes to the neutral label and tone instead of crashing', () => {
    expect(getKindLabel(CONTACT_KIND.staff)).toBe('Nhân sự')
    expect(getKindLabel(99)).toBe('Chưa phân loại')
    expect(getKindTone(99)).toBe('neutral')
    expect(getGroupKindTone(GROUP_KIND.internal)).toBe('done')
  })

  it('splits tags on comma, semicolon and newline, dropping blanks and duplicates', () => {
    expect(splitTags('vip, đại lý;miền Nam\n vip ')).toEqual(['vip', 'đại lý', 'miền Nam'])
    // Xóa hết ô thẻ phải gửi mảng rỗng để máy chủ gỡ thẻ cũ, không phải [''].
    expect(splitTags('')).toEqual([])
    expect(splitTags(' , ;; \n ')).toEqual([])
  })
})
