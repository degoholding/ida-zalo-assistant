import { describe, expect, it } from 'vitest'

import {
  buildFormDefaults,
  percentInputToRatio,
  ratioToPercentInput,
  toApiPayload,
  withCurrentValue,
} from './field-values'
import type { CrudFormField } from './types'

const FIELDS: CrudFormField[] = [
  { name: 'code', label: 'Mã' },
  { name: 'vat', label: 'VAT (%)', type: 'percent', defaultValue: 0.08 },
  { name: 'debt_limit', label: 'Hạn mức nợ', type: 'number' },
  { name: 'is_active', label: 'Trạng thái', type: 'switch' },
]

describe('field-values', () => {
  /**
   * Lỗi đã gặp: `0.07 * 100` trong JS ra 7.000000000000001. Đổ thẳng vào ô số là
   * người dùng thấy nguyên cái đuôi thập phân đó trên form nhà cung cấp.
   */
  it('đổi tỉ lệ sang phần trăm không để lại đuôi thập phân rác', () => {
    expect(ratioToPercentInput(0.07)).toBe(7)
    expect(ratioToPercentInput(0.08)).toBe(8)
    expect(ratioToPercentInput(0.105)).toBe(10.5)
  })

  it('ô trống hay chữ vô nghĩa thì coi như 0, không ra NaN', () => {
    expect(ratioToPercentInput('')).toBe(0)
    expect(ratioToPercentInput(null)).toBe(0)
    expect(percentInputToRatio('abc')).toBe(0)
  })

  /** Nhập 8 rồi lưu rồi mở lại phải vẫn là 8 — không được trôi dần qua mỗi vòng. */
  it('gõ phần trăm rồi lưu rồi mở lại vẫn ra đúng con số cũ', () => {
    for (const percent of [0, 5, 8, 10, 33.33]) {
      expect(ratioToPercentInput(percentInputToRatio(percent))).toBe(percent)
    }
  })

  it('giá trị mặc định khai theo dạng lưu, ra form thì thành phần trăm', () => {
    const values = buildFormDefaults(FIELDS)

    expect(values.vat).toBe(8)
    expect(values.code).toBe('')
    expect(values.debt_limit).toBe(0)
    expect(values.is_active).toBe(true)
  })

  it('mở bản ghi có sẵn thì lấy giá trị của bản ghi, không lấy mặc định', () => {
    const values = buildFormDefaults(FIELDS, { code: 'HOAPHAT', vat: 0.1, is_active: false })

    expect(values.code).toBe('HOAPHAT')
    expect(values.vat).toBe(10)
    expect(values.is_active).toBe(false)
  })

  /**
   * Backend khai `vat` là `ge=0, lt=1` (CR-058) — gửi thẳng 8 lên là 422.
   * Ô số của trình duyệt trả về CHUỖI nên phải ép kiểu trước khi chia.
   */
  it('gửi lên backend thì phần trăm quy về tỉ lệ và số ép về kiểu số', () => {
    const payload = toApiPayload(FIELDS, {
      code: 'HOAPHAT',
      vat: '8',
      debt_limit: '5000000',
      is_active: true,
    })

    expect(payload.vat).toBe(0.08)
    expect(payload.debt_limit).toBe(5000000)
    expect(payload.code).toBe('HOAPHAT')
  })

  it('xóa trắng ô phần trăm thì gửi 0 chứ không gửi chuỗi rỗng', () => {
    expect(toApiPayload(FIELDS, { vat: '' }).vat).toBe(0)
  })

  /**
   * Lỗi đã gặp: `contract_type` là VARCHAR tự do, 177/179 hợp đồng đang lưu
   * ("Hợp đồng mua bán", "Hợp đồng kinh tế"…) không khớp 5 loại khai ở config.
   * Không bù giá trị đang lưu vào danh sách thì ô chọn hiện chữ gợi ý y như ô
   * trống — người dùng tưởng mất dữ liệu rồi chọn đại, ghi đè giá trị thật.
   *
   * CR-118 đã chuẩn hóa riêng cột đó sang mã tiếng Anh, nhưng lưới bù này phải ở
   * lại: bản ghi cũ chưa chạy migration và các cột VARCHAR tự do khác vẫn y nguyên.
   */
  it('giá trị đang lưu nằm ngoài danh sách chọn thì vẫn hiện, không rơi mất', () => {
    const options = [
      { value: 'principle', label: 'Hợp đồng nguyên tắc' },
      { value: 'purchase', label: 'Hợp đồng mua bán' },
    ]

    const shown = withCurrentValue(options, 'Hợp đồng kinh tế')

    expect(shown).toHaveLength(3)
    expect(shown.at(-1)).toEqual({ value: 'Hợp đồng kinh tế', label: 'Hợp đồng kinh tế' })
  })

  it('giá trị đã có trong danh sách hoặc còn trống thì giữ nguyên danh sách gốc', () => {
    const options = [{ value: 3, label: 'CÔNG TY TNHH SẢN XUẤT HÓA CHẤT ABA' }]

    // Ô chọn nạp từ API trả `value` kiểu số còn form giữ chuỗi — so sánh phải
    // ép về chuỗi, không thì mỗi lần mở lại đẻ thêm một mục trùng.
    expect(withCurrentValue(options, '3')).toBe(options)
    expect(withCurrentValue(options, '')).toBe(options)
    expect(withCurrentValue(options, null)).toBe(options)
  })
})

// bao-CR-502: hóa chất không có năm cấm (banned_year = null) bấm Lưu không đổi gì mà vẫn 422,
// vì `Number(null)` = 0 lọt xuống backend đang chặn năm ngoài 1900–2100.
describe('toApiPayload — number field declared nullWhenEmpty', () => {
  const YEAR: CrudFormField[] = [
    { name: 'banned_year', label: 'Năm bắt đầu cấm', type: 'number', nullWhenEmpty: true },
    { name: 'sort_order', label: 'Thứ tự', type: 'number' },
  ]

  it('sends null back when the record came in as null and nobody touched it', () => {
    expect(toApiPayload(YEAR, { banned_year: null }).banned_year).toBeNull()
  })

  it('sends null when the user clears the box', () => {
    expect(toApiPayload(YEAR, { banned_year: '' }).banned_year).toBeNull()
  })

  it('still converts a typed year, and zero stays zero', () => {
    expect(toApiPayload(YEAR, { banned_year: '2027' }).banned_year).toBe(2027)
    expect(toApiPayload(YEAR, { banned_year: 0 }).banned_year).toBe(0)
  })

  it('leaves number fields that did not opt in on the old null-to-zero path', () => {
    expect(toApiPayload(YEAR, { sort_order: null }).sort_order).toBe(0)
  })
})

describe('withCurrentValue', () => {
  it('bù giá trị cũ ngoài danh sách để ô không hiện trống', () => {
    //  Loại hợp đồng đã bỏ khỏi danh mục thì hợp đồng cũ vẫn phải đọc được nó.
    const got = withCurrentValue([{ value: 'purchase', label: 'Mua bán' }], 'legacy')
    expect(got).toHaveLength(2)
  })

  it('KHÔNG bù `0` — với ô chọn tham chiếu đó là "chưa chọn", không phải một mục', () => {
    //  Backend khai id là số nên chưa chọn lưu thành `0`. Bù vào thì ô hiện đúng
    //  chữ «0» và người dùng đọc ra một lựa chọn tên là "0" (CR màn Loại nghỉ,
    //  07/09/2026).
    const options = [{ value: 3, label: 'Nghỉ bù' }]
    expect(withCurrentValue(options, 0)).toEqual(options)
    expect(withCurrentValue(options, '0')).toEqual(options)
  })

  it('vẫn bù `0` dạng CÓ mục thật — ô chọn nào khai `0` là một lựa chọn thì giữ nguyên', () => {
    //  «Áp dụng cho giới tính» khai `0 = Mọi giới`: mục có sẵn nên không đụng tới.
    const options = [{ value: 0, label: 'Mọi giới' }]
    expect(withCurrentValue(options, 0)).toEqual(options)
  })
})
