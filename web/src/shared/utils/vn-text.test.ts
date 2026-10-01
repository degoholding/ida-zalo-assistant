import { describe, expect, it } from 'vitest'

import { matchesVietnamese, stripDiacritics } from './vn-text'

describe('stripDiacritics', () => {
  it('bỏ dấu và hạ chữ thường', () => {
    expect(stripDiacritics('Tầng 3')).toBe('tang 3')
    expect(stripDiacritics('Nghỉ Phép')).toBe('nghi phep')
  })

  it('xử lý đ / Đ — NFD không đụng tới hai chữ này', () => {
    //  `đ` không phải `d` có dấu nên `normalize('NFD')` để nguyên; quên thay tay
    //  thì gõ "dat phong" không khớp «Đặt phòng».
    expect(stripDiacritics('Đặt phòng')).toBe('dat phong')
    expect(stripDiacritics('đơn vị')).toBe('don vi')
  })

  it('chuỗi rỗng / null không nổ', () => {
    expect(stripDiacritics('')).toBe('')
    expect(stripDiacritics(undefined as unknown as string)).toBe('')
  })
})

describe('matchesVietnamese', () => {
  it('gõ KHÔNG DẤU vẫn khớp — đây là lý do hàm này tồn tại', () => {
    //  Đo 04/09/2026 ở hộp chọn phòng: "tang 3" ra 0 phòng trong khi có 4.
    expect(matchesVietnamese('Phòng họp 301', 'phong hop')).toBe(true)
    expect(matchesVietnamese('Tầng 3', 'tang 3')).toBe(true)
  })

  it('gõ CÓ DẤU cũng khớp', () => {
    expect(matchesVietnamese('Tầng 3', 'Tầng 3')).toBe(true)
  })

  it('không phân biệt hoa thường', () => {
    expect(matchesVietnamese('Hội trường 501', 'HOI TRUONG')).toBe(true)
  })

  it('khớp GIỮA chuỗi, không chỉ đầu chuỗi', () => {
    expect(matchesVietnamese('Máy chiếu, bảng trắng', 'bang trang')).toBe(true)
  })

  it('nhận NHIỀU ô để tìm — mục nào cũng có tên, mã, vị trí', () => {
    const roomFields = ['Phòng họp 301', 'P301', 'Tầng 3', 'TV 55 inch']
    expect(matchesVietnamese(roomFields, 'p301')).toBe(true)
    expect(matchesVietnamese(roomFields, '55 inch')).toBe(true)
    expect(matchesVietnamese(roomFields, 'zzz')).toBe(false)
  })

  it('từ khóa RỖNG hoặc toàn khoảng trắng thì khớp mọi mục', () => {
    expect(matchesVietnamese('bất kỳ', '')).toBe(true)
    expect(matchesVietnamese('bất kỳ', '   ')).toBe(true)
  })

  it('ô rỗng trong danh sách không làm hỏng phép so', () => {
    expect(matchesVietnamese(['Phòng 301', null, undefined, ''], 'phong')).toBe(true)
  })
})
