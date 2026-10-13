import { describe, expect, it } from 'vitest'

import type { MetricMapping } from '../types/metric'
import { createEmptyMapping, validateMetricMapping } from './validate-metric-mapping'

const valid: MetricMapping = {
  date: 'Ngày',
  staff: 'Nhân viên',
  staff_by: 'name',
  area: '',
  metrics: [{ code: 'doanh_so', label: 'Doanh số', column: 'D', unit: 'đ', aggregate: 'sum' }],
}

describe('validateMetricMapping', () => {
  it('accepts a complete mapping (area optional)', () => {
    expect(validateMetricMapping(valid)).toBeNull()
  })
  it('rejects missing date / staff columns', () => {
    expect(validateMetricMapping({ ...valid, date: ' ' })).toMatch(/Ngày/)
    expect(validateMetricMapping({ ...valid, staff: '' })).toMatch(/Nhân viên/)
    expect(validateMetricMapping(null)).toMatch(/Chưa có/)
  })
  it('rejects empty, bad-code, duplicate and column-less metrics with the position in the message', () => {
    expect(validateMetricMapping({ ...valid, metrics: [] })).toMatch(/1 đến 20/)
    expect(validateMetricMapping({ ...valid, metrics: [{ ...valid.metrics[0], code: 'Doanh So' }] })).toMatch(/thứ 1: mã/)
    expect(validateMetricMapping({ ...valid, metrics: [valid.metrics[0], valid.metrics[0]] })).toMatch(/thứ 2.*trùng/)
    expect(validateMetricMapping({ ...valid, metrics: [{ ...valid.metrics[0], column: '' }] })).toMatch(/thiếu cột/)
  })
  it('the empty starter mapping is not valid until filled in', () => {
    expect(validateMetricMapping(createEmptyMapping())).not.toBeNull()
  })
})
