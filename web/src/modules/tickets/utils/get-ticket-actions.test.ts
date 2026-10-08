import { describe, expect, it } from 'vitest'

import { TICKET_STATUS } from '../types/ticket'
import { getTicketActions } from './get-ticket-actions'

describe('getTicketActions', () => {
  it('offers accept, done, cancel and note on a new ticket', () => {
    expect(getTicketActions(TICKET_STATUS.new)).toEqual(['accept', 'done', 'cancel', 'note'])
  })

  it('does not offer accept again once someone is handling the ticket', () => {
    expect(getTicketActions(TICKET_STATUS.inProgress)).toEqual(['done', 'cancel', 'note'])
  })

  it('only offers reopen and note on a closed ticket — done or cancel would be a 409', () => {
    expect(getTicketActions(TICKET_STATUS.done)).toEqual(['reopen', 'note'])
    expect(getTicketActions(TICKET_STATUS.cancelled)).toEqual(['reopen', 'note'])
  })

  it('never offers reopen on an open ticket', () => {
    expect(getTicketActions(TICKET_STATUS.new)).not.toContain('reopen')
    expect(getTicketActions(TICKET_STATUS.inProgress)).not.toContain('reopen')
  })

  it('falls back to note only for a status code it does not know', () => {
    for (const code of [0, -1, 5, 99]) expect(getTicketActions(code)).toEqual(['note'])
  })
})
