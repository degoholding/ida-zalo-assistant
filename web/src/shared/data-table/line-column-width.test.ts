import { describe, expect, it } from 'vitest'

import {
  DATE_CONTROL_MIN_WIDTH,
  LINE_COLUMN_MIN_WIDTH,
  lineColumnMinWidth,
  lineColumnWidth,
} from './line-column-width'

describe('lineColumnMinWidth', () => {
  it('falls back to the shared floor when nothing is declared', () => {
    expect(lineColumnMinWidth({})).toBe(LINE_COLUMN_MIN_WIDTH)
  })

  it('keeps a declared minWidth that is already above the shared floor', () => {
    expect(lineColumnMinWidth({ minWidth: 120 })).toBe(120)
  })

  it('raises a date column whose declared minWidth cannot fit dd/mm/yyyy', () => {
    //  Lỗi thật 10/09/2026: cột "Cam kết giao" khai `minWidth: 100`, ô chọn ngày
    //  cần 155,3px nên mọi ngày đều hiện ra "20/09/…" — đọc không biết năm nào.
    expect(lineColumnMinWidth({ control: 'date', minWidth: 100 })).toBe(DATE_CONTROL_MIN_WIDTH)
  })

  it('does not shrink a date column that already declares something wider', () => {
    expect(lineColumnMinWidth({ control: 'date', minWidth: 200 })).toBe(200)
  })
})

describe('lineColumnWidth', () => {
  it('leaves a column with no declared width flexible', () => {
    expect(lineColumnWidth({})).toBeUndefined()
  })

  it('gives a date column its floor even when no width was declared', () => {
    //  Không có nhánh này thì cột co giãn theo phần bảng còn thừa, và bảng nhiều
    //  cột thì phần thừa đó là 0.
    expect(lineColumnWidth({ control: 'date' })).toBe(DATE_CONTROL_MIN_WIDTH)
  })

  it('passes a declared width through untouched when it clears the floor', () => {
    expect(lineColumnWidth({ control: 'date', width: 170 })).toBe(170)
    expect(lineColumnWidth({ width: 90 })).toBe(90)
  })

  it('raises a declared width that sits below the floor', () => {
    expect(lineColumnWidth({ control: 'date', width: 130 })).toBe(DATE_CONTROL_MIN_WIDTH)
  })

  it('prefers the saved width over the declared one', () => {
    expect(lineColumnWidth({ width: 100 }, 240)).toBe(240)
  })

  it('raises a saved width that sits below the floor', () => {
    //  Đây là nửa quan trọng nhất: `useTableLayout` chỉ lưu cột người dùng TỰ KÉO,
    //  nên sửa `width` trong mã nguồn tới được mọi người TRỪ người đã kéo đúng cột
    //  đó — tức là người khó chịu vì nó nhất. Kẹp cả bản đã lưu thì họ mới hết lỗi.
    expect(lineColumnWidth({ control: 'date', width: 156 }, 110)).toBe(DATE_CONTROL_MIN_WIDTH)
  })

  it('respects a plain column minWidth for saved widths too', () => {
    expect(lineColumnWidth({ width: 200, minWidth: 150 }, 60)).toBe(150)
  })

  it('survives nonsense saved widths without producing a negative column', () => {
    //  `localStorage` là dữ liệu NGƯỜI NGOÀI: ai cũng sửa được bằng devtools, và
    //  một bố cục hỏng từ đời trước vẫn nằm nguyên ở đó.
    expect(lineColumnWidth({ control: 'date' }, 0)).toBe(DATE_CONTROL_MIN_WIDTH)
    expect(lineColumnWidth({ control: 'date' }, -9999)).toBe(DATE_CONTROL_MIN_WIDTH)
    expect(lineColumnWidth({ width: 120 }, -1)).toBe(LINE_COLUMN_MIN_WIDTH)
  })

  it('does not cap absurdly wide columns — that is the user resizing on purpose', () => {
    expect(lineColumnWidth({ width: 100 }, 100000)).toBe(100000)
  })
})

describe('DATE_CONTROL_MIN_WIDTH', () => {
  it('stays wide enough for the measured DatePicker trigger plus cell padding', () => {
    //  Đo trên trình duyệt thật: nút bấm `DatePicker size="sm"` = 135,3px, ô bảng
    //  `px-2.5` hai bên = 20px. Bài kiểm này đỏ lên khi ai đó hạ hằng số xuống mà
    //  chưa đo lại chrome của `DatePicker`.
    expect(DATE_CONTROL_MIN_WIDTH).toBeGreaterThanOrEqual(Math.ceil(135.3 + 20))
  })
})
