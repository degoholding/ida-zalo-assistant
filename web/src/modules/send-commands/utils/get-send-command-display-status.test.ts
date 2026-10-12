import { describe, expect, it } from 'vitest'

import { SEND_COMMAND_STATUS } from '../types/send-command'
import { getSendCommandDisplayStatus } from './get-send-command-display-status'

const make = (status: number, target_count = 3, failed_count = 0) => getSendCommandDisplayStatus({ status, target_count, failed_count })

describe('getSendCommandDisplayStatus', () => {
  it('labels every stored status', () => {
    expect(make(SEND_COMMAND_STATUS.draft).label).toBe('Chờ xác nhận')
    expect(make(SEND_COMMAND_STATUS.scheduled).label).toBe('Đang hẹn')
    expect(make(SEND_COMMAND_STATUS.sending).label).toBe('Đang gửi')
    expect(make(SEND_COMMAND_STATUS.done).label).toBe('Xong')
    expect(make(SEND_COMMAND_STATUS.cancelled).label).toBe('Đã hủy')
    expect(make(SEND_COMMAND_STATUS.expired).label).toBe('Nháp hết hạn')
  })

  it('shows failures of a finished command as "Xong — có lỗi (n/total)" and never as plain Xong', () => {
    expect(make(SEND_COMMAND_STATUS.done, 3, 1)).toEqual({ label: 'Xong — có lỗi (1/3)', tone: 'returned' })
    expect(make(SEND_COMMAND_STATUS.done, 1, 1).label).toBe('Xong — có lỗi (1/1)')
  })

  it('keeps plain Xong for zero failures and for a command with zero targets', () => {
    expect(make(SEND_COMMAND_STATUS.done, 0, 0)).toEqual({ label: 'Xong', tone: 'done' })
  })

  it('ignores failed targets while the command is still sending (the count settles at Done)', () => {
    expect(make(SEND_COMMAND_STATUS.sending, 3, 2).label).toBe('Đang gửi')
  })

  it('returns an empty label for statuses the UI does not know', () => {
    for (const code of [0, -1, 7, Number.NaN]) expect(make(code).label).toBe('')
  })
})
