import { describe, expect, it } from 'vitest'

import { columnColorStyle, findColumnColor, isCustomColor } from './column-color-palette'

describe('tô màu cột', () => {
  it('cột không tô thì không trả style nào', () => {
    expect(columnColorStyle(undefined, 'head')).toBeUndefined()
    expect(columnColorStyle('mau-khong-co', 'cell')).toBeUndefined()
  })

  it('KHÔNG ghi đè background-color — nếu không nền hàng bị nuốt mất', () => {
    //  Lỗi 27/08/2026: hàm này từng trả `backgroundColor: color-mix(màu, var(--muted))`,
    //  tức tự đoán nền phía dưới. Đoán sai hai chỗ: hàng tiêu đề chạy trên
    //  `--row-head` chứ không phải `--muted` (nên ô được tô nhạt hơn hẳn các ô
    //  bên cạnh, nhìn ra thành "tiêu đề hai màu"), và ô thân luôn pha vào
    //  `--card` nên cột được tô phớt lờ vằn hàng chẵn lẻ lẫn nền hover.
    for (const part of ['head', 'cell'] as const) {
      const style = columnColorStyle('blue', part)
      expect(style?.backgroundColor, part).toBeUndefined()
      expect(style?.backgroundImage, part).toBeTruthy()
    }
  })

  it('lớp phủ trong suốt một phần để nền hàng lộ qua', () => {
    const style = columnColorStyle('blue', 'cell')
    expect(style?.backgroundImage).toContain('transparent')
  })

  it('tiêu đề đậm hơn thân bảng', () => {
    //  Tiêu đề là chỗ người dùng dò tìm cột nên phải bắt mắt hơn; thân bảng chỉ
    //  cần sắc phớt, đậm quá là lấn chữ.
    const dam = (part: 'head' | 'cell') =>
      Number(/(\d+)%/.exec(String(columnColorStyle('blue', part)?.backgroundImage))?.[1])
    expect(dam('head')).toBeGreaterThan(dam('cell'))
  })

  it('nhận màu tự chọn dạng mã hex, không chỉ tám màu dựng sẵn', () => {
    expect(isCustomColor('#1a2b3c')).toBe(true)
    expect(isCustomColor('blue')).toBe(false)
    expect(findColumnColor('#1a2b3c')?.value).toBe('#1a2b3c')
    expect(columnColorStyle('#1a2b3c', 'head')?.backgroundImage).toContain('#1a2b3c')
  })
})
