import { describe, expect, it } from 'vitest'

import { getPath, setPath } from './field-path'
import { toApiPayload } from './field-values'
import type { CrudFormField } from './types'

describe('nullWhenEmpty — ô trống gửi null thay vì chuỗi rỗng', () => {
  const ngay = (over: Partial<CrudFormField> = {}): CrudFormField[] => [
    { name: 'd', label: 'Ngày', type: 'date', ...over },
  ]

  it('ô KHAI cờ thì trống gửi `null`', () => {
    //  Backend khai `date | None` trả 422 «input is too short» khi nhận `''`,
    //  cho một ô người dùng CỐ Ý bỏ trống — và họ chỉ thấy bấm Lưu mà không có
    //  gì xảy ra.
    expect(toApiPayload(ngay({ nullWhenEmpty: true }), { d: '' }).d).toBeNull()
  })

  it('ô KHÔNG khai cờ thì giữ nguyên chuỗi rỗng', () => {
    //  ⚠️ LỖI ĐÃ TRÁNH (17/09/2026): bản đầu áp `null` cho MỌI ô `type: 'date'`.
    //  Các danh mục cũ khai ngày là `str = ""` ở backend, và chúng trả 422
    //  «Input should be a valid string» khi nhận `null` — tức là màn *Hợp đồng*
    //  và *Phân loại VTBB* đang chạy thật mất luôn khả năng tạo mới khi để
    //  trống ngày. Thử được bằng cách bắn thẳng vào API.
    expect(toApiPayload(ngay(), { d: '' }).d).toBe('')
  })

  it('có giá trị thì cờ không đụng tới', () => {
    const fields = ngay({ nullWhenEmpty: true })
    expect(toApiPayload(fields, { d: '2026-09-17' }).d).toBe('2026-09-17')
  })

  it('cờ áp được cho cả ô lồng nhau', () => {
    const fields: CrudFormField[] = [
      { name: 'extra_fields.ngay', label: 'Ngày', type: 'date', nullWhenEmpty: true },
    ]
    const out = toApiPayload(fields, { extra_fields: { ngay: '' } })
    expect((out.extra_fields as Record<string, unknown>).ngay).toBeNull()
  })
})

/**
 * Đường dẫn có dấu chấm — nền của ô nhập LỒNG NHAU (`extra_fields.so_gp`).
 *
 * Hai hàm này im lặng khi sai, nên bài kiểm phải cực đoan: sai `getPath` thì giá
 * trị đã lưu không đổ vào ô (người dùng thấy ô trống và tin là chưa ai nhập),
 * sai `setPath` thì hoặc ô không nhận giá trị khởi tạo, hoặc — tệ hơn — nó ghi
 * đè lên trạng thái nội bộ của react-hook-form sau lưng thư viện.
 */
describe('getPath', () => {
  it('đọc khóa trần y như truy cập thẳng', () => {
    expect(getPath({ name: 'Hợp đồng' }, 'name')).toBe('Hợp đồng')
  })

  it('đi xuyên qua đường dẫn lồng nhau', () => {
    expect(getPath({ extra_fields: { so_gp: 'GP-01' } }, 'extra_fields.so_gp')).toBe('GP-01')
  })

  it('nhánh giữa chừng thiếu thì trả undefined, KHÔNG ném lỗi', () => {
    //  Hồ sơ cũ có `extra_fields = null`. Ném ở đây là vỡ cả màn danh sách vì
    //  MỘT dòng chưa ai điền ô nào.
    expect(getPath({}, 'extra_fields.so_gp')).toBeUndefined()
    expect(getPath({ extra_fields: null }, 'extra_fields.so_gp')).toBeUndefined()
    expect(getPath(null, 'a.b')).toBeUndefined()
    expect(getPath(undefined, 'a')).toBeUndefined()
  })

  it('giữ nguyên các giá trị "giả" — 0, chuỗi rỗng, false', () => {
    //  ⚠️ Nơi gọi phân biệt `undefined` (chưa có) với `''` (đã nhập, rỗng), nên
    //  hàm này không được gộp chúng lại. `false` của một ô công tắc là một câu
    //  trả lời thật.
    const src = { extra_fields: { a: 0, b: '', c: false } }
    expect(getPath(src, 'extra_fields.a')).toBe(0)
    expect(getPath(src, 'extra_fields.b')).toBe('')
    expect(getPath(src, 'extra_fields.c')).toBe(false)
  })

  it('không nhầm khóa TRẦN chứa dấu chấm với đường dẫn', () => {
    //  react-hook-form luôn tách theo dấu chấm, nên một khóa trần như vậy là
    //  không với tới được — đúng lý do mã trường bị cấm chứa dấu chấm
    //  (`slugifyFieldKey`). Bài này chốt rằng hai hàm nói cùng một ngôn ngữ.
    expect(getPath({ 'a.b': 1 }, 'a.b')).toBeUndefined()
  })
})

describe('setPath', () => {
  it('ghi khóa trần', () => {
    expect(setPath({}, 'name', 'x')).toEqual({ name: 'x' })
  })

  it('dựng nhánh còn thiếu trên đường đi', () => {
    expect(setPath({}, 'extra_fields.so_gp', 'GP-01')).toEqual({
      extra_fields: { so_gp: 'GP-01' },
    })
  })

  it('giữ nguyên các khóa anh em trong cùng nhánh', () => {
    const before = { extra_fields: { a: 1, b: 2 } }
    expect(setPath(before, 'extra_fields.b', 9)).toEqual({ extra_fields: { a: 1, b: 9 } })
  })

  it('KHÔNG sửa vật thể gốc, kể cả nhánh con', () => {
    //  ⚠️ Đây là lý do hàm nhân bản từng tầng. `toApiPayload` nhận thẳng đối
    //  tượng giá trị của react-hook-form; ghi đè vào đó là sửa trạng thái nội
    //  bộ của form sau lưng nó.
    const before = { extra_fields: { a: 1 } }
    const after = setPath(before, 'extra_fields.a', 2)

    expect(before).toEqual({ extra_fields: { a: 1 } })
    expect(after.extra_fields).not.toBe(before.extra_fields)
  })

  it('thay nhánh không phải đối tượng bằng một đối tượng mới', () => {
    //  Ca thật: `extra_fields` đang là `null` (hồ sơ cũ) hoặc một chuỗi (dữ liệu
    //  hỏng). Đi xuyên qua nó thì nổ, nên phải dựng lại.
    expect(setPath({ extra_fields: null }, 'extra_fields.a', 1)).toEqual({
      extra_fields: { a: 1 },
    })
    expect(setPath({ extra_fields: 'rác' }, 'extra_fields.a', 1)).toEqual({
      extra_fields: { a: 1 },
    })
  })

  it('ghi được giá trị rỗng / 0 / false chứ không bỏ qua chúng', () => {
    expect(setPath({}, 'extra_fields.a', '')).toEqual({ extra_fields: { a: '' } })
    expect(setPath({}, 'extra_fields.a', false)).toEqual({ extra_fields: { a: false } })
    expect(setPath({}, 'extra_fields.a', 0)).toEqual({ extra_fields: { a: 0 } })
  })

  it('đi được nhiều tầng', () => {
    expect(setPath({}, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } })
  })

  it('đọc lại được đúng thứ vừa ghi', () => {
    //  Chốt CHÉO hai hàm: lệch nhau thì mỗi hàm riêng vẫn xanh mà cặp đôi thì
    //  hỏng — đúng kiểu lỗi "ghi một đằng đọc một nẻo" mà tệp này sinh ra để chặn.
    const out = setPath({}, 'extra_fields.so_gp', 'GP-01')
    expect(getPath(out, 'extra_fields.so_gp')).toBe('GP-01')
  })
})
