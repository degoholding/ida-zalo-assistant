import { describe, expect, it } from 'vitest'

import { contrastRatio, ensureVisibleAgainst, isNeutral, measureColor } from './color-hue'
import { colorMatchesWord, findFirstColorWord } from './color-words'

describe('measureColor', () => {
  it('đọc được cả dạng rút gọn 3 ký tự', () => {
    expect(measureColor('#fff').lightness).toBe(100)
    expect(measureColor('#ffffff').lightness).toBe(100)
  })

  it('ném lỗi với chuỗi không phải hex, thay vì trả số 0 im lặng', () => {
    expect(() => measureColor('rgb(1,2,3)')).toThrow()
    expect(() => measureColor('oklch(0.5 0.1 200)')).toThrow()
  })
})

describe('isNeutral', () => {
  it('coi màu gần trắng là trung tính dù độ bão hoà HSL của nó cao vô lý', () => {
    //  LỖI SUÝT MẮC: `#f8fafc` (nền của Clean Slate) lệch kênh đúng 4/255 —
    //  mắt thấy trắng — nhưng độ bão hoà HSL ra 40%. Đo bằng HSL thì phép kiểm
    //  "nền này có phải màu xám không" trả lời SAI.
    expect(isNeutral('#f8fafc')).toBe(true)
    expect(isNeutral('#eff1f5')).toBe(true)
    expect(isNeutral('#ffffff')).toBe(true)
    expect(isNeutral('#606060')).toBe(true)
  })

  it('không coi xanh xô thơm là trung tính — nó nhạt nhưng vẫn có màu', () => {
    expect(isNeutral('#7c9082')).toBe(false)
  })
})

describe('findFirstColorWord', () => {
  it('lấy từ đứng ĐẦU, vì mô tả mở đầu bằng màu chủ đạo', () => {
    expect(findFirstColorWord('Chàm tím, nền trắng')?.word).toBe('chàm')
  })

  it('từ dài thắng từ ngắn khi cùng vị trí — "xanh lá" không bị "lá" nuốt', () => {
    expect(findFirstColorWord('Xanh lá thiên nhiên')?.word).toBe('xanh lá')
    expect(findFirstColorWord('Xanh dương đêm sao')?.word).toBe('xanh dương')
  })

  it('trả null khi mô tả không nói màu nào', () => {
    expect(findFirstColorWord('Viền dày, góc vuông')).toBeNull()
  })
})

describe('colorMatchesWord', () => {
  it('tách được nâu với cam dù cùng góc màu — nâu phải trầm và tối', () => {
    const nau = findFirstColorWord('Nâu mocha')!
    expect(colorMatchesWord('#a37764', nau)).toBe(true)
    // Hổ phách `#f59e0b` cùng vùng góc màu nhưng rực và sáng: không phải nâu.
    expect(colorMatchesWord('#f59e0b', nau)).toBe(false)
  })

  it('màu quá nhạt không được gọi tên là màu gì cả', () => {
    const tim = findFirstColorWord('Tím')!
    expect(colorMatchesWord('#f8fafc', tim)).toBe(false)
  })
})

describe('ensureVisibleAgainst', () => {
  it('trả nguyên màu khi nó đã nổi đủ', () => {
    expect(ensureVisibleAgainst('#2a78d6', '#ffffff', 2)).toBe('#2a78d6')
  })

  it('dìm màu xuống khi nền sáng, đẩy màu lên khi nền tối', () => {
    const onLight = ensureVisibleAgainst('#ffe6c4', '#fcfcfc', 2)
    expect(measureColor(onLight).lightness).toBeLessThan(measureColor('#ffe6c4').lightness)
    expect(contrastRatio(onLight, '#fcfcfc')).toBeGreaterThanOrEqual(2)

    const onDark = ensureVisibleAgainst('#2a2a2a', '#191919', 2)
    expect(measureColor(onDark).lightness).toBeGreaterThan(measureColor('#2a2a2a').lightness)
    expect(contrastRatio(onDark, '#191919')).toBeGreaterThanOrEqual(2)
  })

  it('giữ nguyên góc màu — cột biểu đồ sáng lên nhưng vẫn đúng tông bảng màu', () => {
    const before = measureColor('#ffe6c4')
    const after = measureColor(ensureVisibleAgainst('#ffe6c4', '#fcfcfc', 2))
    expect(Math.abs(after.hue - before.hue)).toBeLessThanOrEqual(2)
  })

  it('màu xám vẫn ra màu xám, không bị nhuốm màu', () => {
    expect(isNeutral(ensureVisibleAgainst('#e8e8e8', '#fcfcfc', 2))).toBe(true)
  })
})
