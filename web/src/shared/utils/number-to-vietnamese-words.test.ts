import { describe, expect, it } from 'vitest'

import { numberToVietnameseWords } from './number-to-vietnamese-words'

describe('numberToVietnameseWords', () => {
  it('đọc các bậc nghìn / triệu / tỷ', () => {
    expect(numberToVietnameseWords(1_000)).toBe('Một nghìn đồng chẵn')
    expect(numberToVietnameseWords(4_760_000)).toBe(
      'Bốn triệu bảy trăm sáu mươi nghìn đồng chẵn',
    )
    expect(numberToVietnameseWords(1_000_000_000)).toBe('Một tỷ đồng chẵn')
  })

  it('đọc đủ hàng trăm ở nhóm dưới để không sai bậc', () => {
    // Bỏ "không trăm" đi thì "một triệu năm mươi nghìn" nghe thành 1.050.000
    // hay 1.000.050 tùy người đọc — chứng từ không được phép mơ hồ.
    expect(numberToVietnameseWords(1_050_000)).toBe(
      'Một triệu không trăm năm mươi nghìn đồng chẵn',
    )
    expect(numberToVietnameseWords(1_001)).toBe(
      'Một nghìn không trăm lẻ một đồng chẵn',
    )
  })

  it('đọc đúng biến thể "mốt", "lăm", "lẻ"', () => {
    expect(numberToVietnameseWords(21)).toBe('Hai mươi mốt đồng chẵn')
    expect(numberToVietnameseWords(25)).toBe('Hai mươi lăm đồng chẵn')
    expect(numberToVietnameseWords(15)).toBe('Mười lăm đồng chẵn')
    expect(numberToVietnameseWords(105)).toBe('Một trăm lẻ năm đồng chẵn')
  })

  it('làm tròn về đồng trước khi đọc', () => {
    // Đơn giá giữ tới 4 số thập phân nên tổng tiền hay có đuôi lẻ.
    expect(numberToVietnameseWords(4_760_000.08)).toBe(
      'Bốn triệu bảy trăm sáu mươi nghìn đồng chẵn',
    )
    expect(numberToVietnameseWords(1_000.6)).toBe(
      'Một nghìn không trăm lẻ một đồng chẵn',
    )
  })

  it('đọc đủ bốn bậc tỷ / triệu / nghìn / trăm trong một số', () => {
    // Gộp về đây từ bản `doc-tien.ts` đã bỏ (bao-CR-322) — hai tệp cùng một
    // thuật toán, giữ lại đúng mấy ca bản kia có mà bản này chưa có.
    expect(numberToVietnameseWords(1_234_567_890)).toBe(
      'Một tỷ hai trăm ba mươi bốn triệu năm trăm sáu mươi bảy nghìn tám trăm chín mươi đồng chẵn',
    )
  })

  it('đọc "mốt" cả khi nó nằm ở nhóm bậc chứ không phải nhóm cuối', () => {
    expect(numberToVietnameseWords(21_000_000)).toBe('Hai mươi mốt triệu đồng chẵn')
    expect(numberToVietnameseWords(15_000)).toBe('Mười lăm nghìn đồng chẵn')
    expect(numberToVietnameseWords(105_000)).toBe('Một trăm lẻ năm nghìn đồng chẵn')
  })

  it('số không, số âm và giá trị hỏng đều ra "Không đồng"', () => {
    expect(numberToVietnameseWords(0)).toBe('Không đồng')
    expect(numberToVietnameseWords(-5_000)).toBe('Không đồng')
    expect(numberToVietnameseWords(Number.NaN)).toBe('Không đồng')
  })
})
