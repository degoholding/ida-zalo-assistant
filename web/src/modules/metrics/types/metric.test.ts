import { describe, expect, it } from 'vitest'

import { getMetricFlagLabels, getMetricSourceStatusLabel, METRIC_FLAG, METRIC_SOURCE_STATUS } from './metric'

describe('metric types', () => {
  it('lists the label of every flag bit that is on', () => {
    expect(getMetricFlagLabels(0)).toEqual([])
    expect(getMetricFlagLabels(METRIC_FLAG.negative | METRIC_FLAG.deviation)).toEqual(['Số âm', 'Lệch quá 30% so kỳ trước'])
    expect(getMetricFlagLabels(15)).toHaveLength(4)
  })
  it('labels source statuses and returns empty for unknown codes', () => {
    expect(getMetricSourceStatusLabel(METRIC_SOURCE_STATUS.mappingError)).toBe('Lỗi ánh xạ cột')
    expect(getMetricSourceStatusLabel(99)).toBe('')
  })
})
