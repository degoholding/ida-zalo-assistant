import { describe, expect, it } from 'vitest'

import { REPLY_TEMPLATE_STATUS } from '../types/reply-template'
import { getReplyTemplateActions } from './get-reply-template-actions'

const make = (status: number, can_edit: boolean, can_review: boolean) => getReplyTemplateActions({ status, can_edit, can_review })

describe('getReplyTemplateActions', () => {
  it('lets the author submit a draft but never approve', () => {
    expect(make(REPLY_TEMPLATE_STATUS.draft, true, false)).toEqual(['submit'])
  })

  it('gives reviewers approve / return on pending templates, plus archive', () => {
    expect(make(REPLY_TEMPLATE_STATUS.pendingReview, true, true)).toEqual(['approve', 'return', 'archive'])
  })

  it('shows nothing to a non-reviewer on a pending template', () => {
    expect(make(REPLY_TEMPLATE_STATUS.pendingReview, true, false)).toEqual([])
  })

  it('offers only archive on approved and returned templates for reviewers', () => {
    expect(make(REPLY_TEMPLATE_STATUS.approved, true, true)).toEqual(['archive'])
    expect(make(REPLY_TEMPLATE_STATUS.returned, true, true)).toEqual(['archive'])
  })

  it('offers nothing on an archived template', () => {
    expect(make(REPLY_TEMPLATE_STATUS.archived, true, true)).toEqual([])
  })

  it('lets a reviewer submit a seeded draft (can_edit true for reviewers) and archive it', () => {
    expect(make(REPLY_TEMPLATE_STATUS.draft, true, true)).toEqual(['submit', 'archive'])
  })
})
