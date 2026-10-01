import { describe, expect, it } from 'vitest'

import { applyClientFilter } from './apply-client-filter'
import type { FilterFieldDefinition, FilterRow, FilterState, FilterValue } from '../types'

const NAME: FilterFieldDefinition = { name: 'ten', label: 'Tên', type: 'text' }
const NUMBER: FilterFieldDefinition = { name: 'so', label: 'Số', type: 'number' }
const DATE: FilterFieldDefinition = { name: 'ngay', label: 'Ngày', type: 'date' }
const CO: FilterFieldDefinition = { name: 'co', label: 'Cờ', type: 'boolean' }

function state(rows: Partial<FilterRow>[], conjunction: 'and' | 'or' = 'and'): FilterState {
  return {
    conjunction,
    rows: rows.map((row, index) => ({
      id: String(index),
      field: null,
      operator: null,
      value: null as FilterValue,
      ...row,
    })),
  }
}

const ROW = [
  { ten: 'Quy chế bảo mật', so: 5, ngay: '2026-03-01', co: true },
  { ten: 'Quy trình mua hàng', so: 12, ngay: '2026-09-15', co: false },
  { ten: 'Thông báo nghỉ Tết', so: 0, ngay: null, co: false },
]

describe('applyClientFilter', () => {
  it('không có điều kiện nào hợp lệ thì trả nguyên danh sách', () => {
    expect(applyClientFilter(ROW, state([]))).toHaveLength(3)
    //  Dòng thiếu operator chưa phải điều kiện — không được lọc mất gì.
    expect(applyClientFilter(ROW, state([{ field: NAME }]))).toHaveLength(3)
  })

  it('nhiều điều kiện nối bằng VÀ thì phải thỏa hết', () => {
    const result = applyClientFilter(
      ROW,
      state([
        { field: NAME, operator: 'contains', value: 'quy' },
        { field: NUMBER, operator: 'gt', value: 10 },
      ]),
    )
    expect(result.map((row) => row.ten)).toEqual(['Quy trình mua hàng'])
  })

  it('nối bằng HOẶC thì chỉ cần thỏa một', () => {
    const result = applyClientFilter(
      ROW,
      state(
        [
          { field: NUMBER, operator: 'is', value: 5 },
          { field: NAME, operator: 'contains', value: 'tết' },
        ],
        'or',
      ),
    )
    expect(result).toHaveLength(2)
  })

  it('so khớp chữ không phân biệt hoa thường', () => {
    const result = applyClientFilter(
      ROW,
      state([{ field: NAME, operator: 'contains', value: 'BẢO MẬT' }]),
    )
    expect(result).toHaveLength(1)
  })

  describe('để trống / có giá trị', () => {
    it('số 0 và cờ false là CÓ giá trị, không phải để trống', () => {
      //  Lỗi kinh điển: dùng `!value` nên số 0 bị coi là rỗng và biến mất khỏi
      //  kết quả "có giá trị".
      const result = applyClientFilter(ROW, state([{ field: NUMBER, operator: 'is_not_empty' }]))
      expect(result).toHaveLength(3)
    })

    it('null là để trống', () => {
      const result = applyClientFilter(ROW, state([{ field: DATE, operator: 'is_empty' }]))
      expect(result.map((row) => row.ten)).toEqual(['Thông báo nghỉ Tết'])
    })
  })

  describe('khoảng hở một đầu', () => {
    it('số: bỏ trống đầu trên thì không chặn phía trên', () => {
      const result = applyClientFilter(
        ROW,
        state([{ field: NUMBER, operator: 'between', value: ['5', ''] }]),
      )
      expect(result.map((row) => row.so)).toEqual([5, 12])
    })

    it('ngày: bỏ trống đầu dưới thì không chặn phía dưới', () => {
      const result = applyClientFilter(
        ROW,
        state([{ field: DATE, operator: 'between', value: ['', '2026-06-30'] }]),
      )
      expect(result.map((row) => row.ten)).toEqual(['Quy chế bảo mật'])
    })
  })

  describe('ngày', () => {
    it('so sánh đúng thứ tự thời gian', () => {
      const result = applyClientFilter(
        ROW,
        state([{ field: DATE, operator: 'gte', value: '2026-06-01' }]),
      )
      expect(result.map((row) => row.ten)).toEqual(['Quy trình mua hàng'])
    })

    it('dòng KHÔNG có ngày bị loại khỏi mọi phép so sánh mốc', () => {
      //  Coi như lọt thì dòng trống ngày nằm lẫn trong kết quả "từ ngày X" —
      //  người đọc tưởng nó có ngày trong khoảng.
      const result = applyClientFilter(
        ROW,
        state([{ field: DATE, operator: 'lte', value: '2030-01-01' }]),
      )
      expect(result.map((row) => row.ten)).not.toContain('Thông báo nghỉ Tết')
    })

    it('mốc ngày khớp được cả giá trị có kèm giờ', () => {
      const hang = [{ ngay: '2026-03-01T08:30:00' }]
      const result = applyClientFilter(
        hang,
        state([{ field: DATE, operator: 'is', value: '2026-03-01' }]),
      )
      expect(result).toHaveLength(1)
    })
  })

  it('cờ đúng/sai nhận cả chuỗi "true" từ ô chọn', () => {
    const result = applyClientFilter(
      ROW,
      state([{ field: CO, operator: 'is', value: 'true' }]),
    )
    expect(result.map((row) => row.ten)).toEqual(['Quy chế bảo mật'])
  })

  it('operator không đánh giá được thì LOẠI dòng, không cho lọt', () => {
    //  Cho lọt là người dùng tưởng đã lọc mà đang nhìn nguyên danh sách — sai
    //  mà không có dấu hiệu gì.
    const result = applyClientFilter(
      ROW,
      state([{ field: NAME, operator: 'gt', value: 'x' }]),
    )
    expect(result).toHaveLength(0)
  })
})
