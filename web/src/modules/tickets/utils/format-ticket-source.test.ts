import { describe, expect, it } from 'vitest'

import { formatTicketSource } from './format-ticket-source'

describe('formatTicketSource', () => {
  it('shows the group name for a ticket reported in a group', () => {
    expect(formatTicketSource({ source_kind: 'group', source_name: 'Kế toán 52' })).toBe('Kế toán 52')
  })

  it('still says it is a group when the group has lost its name', () => {
    expect(formatTicketSource({ source_kind: 'group', source_name: '' })).toBe('Nhóm (chưa rõ tên)')
    expect(formatTicketSource({ source_kind: 'group', source_name: '   ' })).toBe('Nhóm (chưa rõ tên)')
  })

  it('shows «Tin riêng» for a direct message whatever name the server sends', () => {
    expect(formatTicketSource({ source_kind: 'direct', source_name: 'Tin riêng' })).toBe('Tin riêng')
    expect(formatTicketSource({ source_kind: 'direct', source_name: '' })).toBe('Tin riêng')
  })

  it('shows a dash when the source thread is unknown', () => {
    expect(formatTicketSource({ source_kind: '', source_name: '' })).toBe('—')
  })
})
