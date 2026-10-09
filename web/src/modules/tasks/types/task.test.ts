import { describe, expect, it } from 'vitest'

import { TONE_CLASS } from '@/shared/ui/status-tone'
import {
  getTaskEventLabel,
  getTaskPriorityLabel,
  getTaskSourceLabel,
  getTaskStatusLabel,
  getTaskStatusTone,
  isTaskOpen,
  TASK_EVENT_KIND,
  TASK_PRIORITY,
  TASK_SOURCE,
  TASK_STATUS,
  TASK_STATUS_OPTIONS,
} from './task'

describe('task status mapping', () => {
  it('mirrors the server TaskStatus codes 1..4 with the Vietnamese labels', () => {
    //  Chép tay từ `src/constants.ts` — lệch một số là lọc «Đang làm» ra việc «Đã xong».
    expect(TASK_STATUS).toEqual({ proposed: 1, open: 2, done: 3, cancelled: 4 })
    expect(TASK_STATUS_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      [1, 'Chờ xác nhận'],
      [2, 'Đang làm'],
      [3, 'Đã xong'],
      [4, 'Đã hủy'],
    ])
  })

  it('gives every status its own colour, and each colour exists in the shared palette', () => {
    const tones = TASK_STATUS_OPTIONS.map((option) => getTaskStatusTone(option.value))
    expect(new Set(tones).size).toBe(tones.length)
    for (const tone of tones) expect(TONE_CLASS[tone]).toBeTruthy()
    expect(getTaskStatusTone(TASK_STATUS.cancelled)).toBe('danger')
    expect(getTaskStatusTone(TASK_STATUS.done)).toBe('done')
  })

  it('falls back to an empty label and the neutral colour for codes the UI does not know', () => {
    for (const code of [0, -1, 5, 99, Number.NaN]) {
      expect(getTaskStatusLabel(code)).toBe('')
      expect(getTaskStatusTone(code)).toBe('neutral')
    }
  })

  it('treats only Proposed and Open as still-open, like the server isOpenLike rule', () => {
    expect([1, 2, 3, 4, 0, 99].filter(isTaskOpen)).toEqual([1, 2])
  })
})

describe('task priority / source mapping', () => {
  it('mirrors TaskPriority 1..3', () => {
    expect(TASK_PRIORITY).toEqual({ high: 1, normal: 2, low: 3 })
    expect(getTaskPriorityLabel(TASK_PRIORITY.high)).toBe('Cao')
    expect(getTaskPriorityLabel(99)).toBe('')
  })

  it('mirrors TaskSource 1..5', () => {
    expect(TASK_SOURCE).toEqual({ command: 1, assistant: 2, recap: 3, aiReview: 4, web: 5 })
    expect(getTaskSourceLabel(TASK_SOURCE.web)).toBe('Web')
    expect(getTaskSourceLabel(TASK_SOURCE.recap)).toBe('Recap họp')
    expect(getTaskSourceLabel(0)).toBe('')
  })
})

describe('task event labels', () => {
  it('labels all eleven server event kinds and returns empty for an unknown one', () => {
    expect(Object.values(TASK_EVENT_KIND).map(getTaskEventLabel)).toEqual([
      'Tạo', 'Xác nhận', 'Bỏ đề xuất', 'Xong', 'Mở lại', 'Dời hạn', 'Giao lại', 'Hủy', 'Ghi chú', 'Nhắc hạn', 'Hết hạn xác nhận',
    ])
    expect(getTaskEventLabel(0)).toBe('')
    expect(getTaskEventLabel(12)).toBe('')
  })
})
