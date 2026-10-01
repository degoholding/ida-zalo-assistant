import { describe, expect, it } from 'vitest'

import { columnLabel, splitRequiredHeader } from './required-header'

describe('splitRequiredHeader', () => {
  it('tách được đuôi " *" thành cờ bắt buộc, tiêu đề còn lại sạch dấu sao', () => {
    expect(splitRequiredHeader('Kho nhận *')).toEqual({ label: 'Kho nhận', required: true })
  })

  it('cột không bắt buộc thì giữ nguyên tiêu đề', () => {
    expect(splitRequiredHeader('Phân loại')).toEqual({ label: 'Phân loại', required: false })
  })

  it('dấu sao dính liền chữ KHÔNG tính là cột bắt buộc — quy ước là dấu cách rồi mới tới sao', () => {
    // "VAT%*" hay "SL*" là gõ thiếu dấu cách, không phải khai báo cột bắt buộc.
    // Nhận nhầm thì tiêu đề bị cắt cụt mất một ký tự.
    expect(splitRequiredHeader('SL*')).toEqual({ label: 'SL*', required: false })
  })

  it('tiêu đề có dấu sao ở GIỮA vẫn là tiêu đề thường', () => {
    expect(splitRequiredHeader('Ghi chú * nội bộ')).toEqual({
      label: 'Ghi chú * nội bộ',
      required: false,
    })
  })
})

describe('columnLabel', () => {
  it('trả tên cột không kèm dấu sao — dùng cho menu ẩn/hiện và nhãn kéo thả', () => {
    // Lỗi từng gặp: nhãn khối kéo thả hiện "Mã hàng *", nhìn như tên cột bị lỗi.
    expect(columnLabel('Mã hàng *')).toBe('Mã hàng')
    expect(columnLabel('Thành tiền')).toBe('Thành tiền')
  })
})
