import { describe, expect, it } from 'vitest'

import type { MetricMapping } from '../types/metric'
import { checkMappingColumns, isColumnFound } from './check-mapping-columns'

const headers = ['Ngày báo cáo', 'Nhân viên', 'Doanh số (đ)']

describe('isColumnFound', () => {
  it('matches a header ignoring case, accents and extra spaces', () => {
    expect(isColumnFound('ngay  bao cao', headers)).toBe(true)
    expect(isColumnFound('DOANH SỐ (Đ)', headers)).toBe(true)
  })
  it('accepts column letters A..ZZ and rejects unknown names', () => {
    expect(isColumnFound('D', headers)).toBe(true)
    expect(isColumnFound('ZZ', headers)).toBe(true)
    expect(isColumnFound('Tồn kho', headers)).toBe(false)
    expect(isColumnFound('', headers)).toBe(false)
  })
})

describe('checkMappingColumns', () => {
  const mapping: MetricMapping = {
    date: 'Ngày báo cáo',
    staff: 'Nhân viên',
    staff_by: 'name',
    area: 'Khu vực',
    metrics: [
      { code: 'doanh_so', label: 'Doanh số', column: 'Doanh số (đ)', unit: 'đ', aggregate: 'sum' },
      { code: 'ton_kho', label: 'Tồn kho', column: 'Tồn kho', unit: '', aggregate: 'last' },
    ],
  }
  it('flags the columns the sheet does not have', () => {
    const result = checkMappingColumns(mapping, headers)
    expect(result.map((check) => [check.role, check.found])).toEqual([
      ['Ngày', true],
      ['Nhân viên', true],
      ['Khu vực', false],
      ['Doanh số', true],
      ['Tồn kho', false],
    ])
  })
  it('skips the area check when no area column is mapped', () => {
    expect(checkMappingColumns({ ...mapping, area: '' }, headers).some((check) => check.role === 'Khu vực')).toBe(false)
  })
})
