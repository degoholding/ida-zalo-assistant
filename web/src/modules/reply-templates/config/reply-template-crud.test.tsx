import { describe, expect, it } from 'vitest'

import { REPLY_TEMPLATE_STATUS, type ReplyTemplate } from '../types/reply-template'
import { replyTemplateCrudConfig } from './reply-template-crud'

const makeTemplate = (overrides: Partial<ReplyTemplate> = {}): ReplyTemplate => ({
  id: 4, name: 'Báo giá', situation: '', keywords: '', body: 'Dạ em gửi giá [giá]', tone: 1, status: REPLY_TEMPLATE_STATUS.approved,
  author_user_id: 7, author_name: 'Lan', reviewer_user_id: null, reviewer_name: '', review_note: '', submitted_at: null, reviewed_at: null,
  created_at: '2026-10-12T01:00:00Z', updated_at: '2026-10-12T01:00:00Z', can_edit: true, can_review: false, ...overrides,
})

/** Review phase 10: nhân viên mở mẫu của người khác (`can_edit` = false từ máy chủ) không được thấy "Lưu" (bấm là 403). */
describe('replyTemplateCrudConfig — row-level edit', () => {
  it('locks the detail form when the server says the caller cannot edit this template', () => {
    expect(replyTemplateCrudConfig.canEditRow?.(makeTemplate({ can_edit: false }))).toBe(false)
    expect(replyTemplateCrudConfig.canEditRow?.(makeTemplate({ can_edit: true }))).toBe(true)
  })
})
