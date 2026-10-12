import { describe, expect, it } from 'vitest'

import { SEND_COMMAND_STATUS } from '../types/send-command'
import { getSendCommandActions } from './get-send-command-actions'

const make = (status: number, failed_count = 0) => ({ status, failed_count })

describe('getSendCommandActions', () => {
  it('offers cancel for a draft or scheduled command, to anyone', () => {
    expect(getSendCommandActions(make(SEND_COMMAND_STATUS.draft), false)).toEqual(['cancel'])
    expect(getSendCommandActions(make(SEND_COMMAND_STATUS.scheduled), false)).toEqual(['cancel'])
  })

  it('offers resend only to admins, only when a target failed and the command has run', () => {
    expect(getSendCommandActions(make(SEND_COMMAND_STATUS.done, 2), true)).toEqual(['resend_failed'])
    expect(getSendCommandActions(make(SEND_COMMAND_STATUS.sending, 1), true)).toEqual(['resend_failed'])
    expect(getSendCommandActions(make(SEND_COMMAND_STATUS.done, 2), false)).toEqual([])
    expect(getSendCommandActions(make(SEND_COMMAND_STATUS.done, 0), true)).toEqual([])
  })

  it('offers nothing for cancelled, expired or unknown statuses even with failures', () => {
    for (const status of [SEND_COMMAND_STATUS.cancelled, SEND_COMMAND_STATUS.expired, 0, 99, Number.NaN]) {
      expect(getSendCommandActions(make(status, 3), true)).toEqual([])
    }
  })
})
