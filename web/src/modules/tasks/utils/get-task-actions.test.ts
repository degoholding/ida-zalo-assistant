import { describe, expect, it } from 'vitest'

import { TASK_STATUS } from '../types/task'
import { getTaskActions } from './get-task-actions'

describe('getTaskActions', () => {
  it('offers confirm and reject only while a proposal is pending', () => {
    expect(getTaskActions(TASK_STATUS.proposed)).toEqual(['confirm', 'reject'])
  })

  it('offers the full set of work actions while open, and never confirm/reject again', () => {
    const actions = getTaskActions(TASK_STATUS.open)
    expect(actions).toEqual(['done', 'reschedule', 'reassign', 'cancel', 'note'])
    expect(actions).not.toContain('confirm')
    expect(actions).not.toContain('reject')
  })

  it('only offers reopen on a closed task — done/cancel/reschedule would be a 409', () => {
    expect(getTaskActions(TASK_STATUS.done)).toEqual(['reopen'])
    expect(getTaskActions(TASK_STATUS.cancelled)).toEqual(['reopen'])
  })

  it('never offers reopen on a task that is still open or proposed', () => {
    expect(getTaskActions(TASK_STATUS.proposed)).not.toContain('reopen')
    expect(getTaskActions(TASK_STATUS.open)).not.toContain('reopen')
  })

  it('offers nothing for a status code it does not know — no guessing', () => {
    for (const code of [0, -1, 5, 99]) expect(getTaskActions(code)).toEqual([])
  })
})
