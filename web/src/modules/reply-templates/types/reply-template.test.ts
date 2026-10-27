import { describe, expect, it } from 'vitest'

import {
  getReplyTemplateStatusLabel,
  getReplyTemplateStatusTone,
  getReplyToneLabel,
  REPLY_TEMPLATE_STATUS,
  REPLY_TEMPLATE_STATUS_OPTIONS,
  REPLY_TONE,
} from './reply-template'

describe('reply template code mapping', () => {
  it('mirrors the server enums in src/constants.ts', () => {
    // Chép tay — lệch một số là lọc "Chờ duyệt" ra "Đã duyệt"
    expect(REPLY_TEMPLATE_STATUS).toEqual({ draft: 1, pendingReview: 2, approved: 3, returned: 4, archived: 5 })
    expect(REPLY_TONE).toEqual({ formal: 1, friendly: 2, brief: 3 })
  })

  it('labels every status and tone in Vietnamese, unknown codes give an empty string', () => {
    expect(REPLY_TEMPLATE_STATUS_OPTIONS.map((option) => getReplyTemplateStatusLabel(option.value))).toEqual([
      'Nháp', 'Chờ duyệt', 'Đã duyệt', 'Bị trả lại', 'Ngừng dùng',
    ])
    expect([1, 2, 3].map(getReplyToneLabel)).toEqual(['Lịch sự', 'Thân thiện', 'Ngắn gọn'])
    expect(getReplyTemplateStatusLabel(99)).toBe('')
    expect(getReplyToneLabel(99)).toBe('')
  })

  it('gives each status a tone and falls back to neutral', () => {
    expect(getReplyTemplateStatusTone(REPLY_TEMPLATE_STATUS.pendingReview)).toBe('pending')
    expect(getReplyTemplateStatusTone(REPLY_TEMPLATE_STATUS.approved)).toBe('done')
    expect(getReplyTemplateStatusTone(99)).toBe('neutral')
  })
})
