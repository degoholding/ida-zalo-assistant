import { describe, expect, it } from 'vitest'

import {
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatTime,
  formatWeekdayDate,
  toDateInputValue,
} from './format-date'

// Toàn bộ tệp này chạy ở TZ Asia/Ho_Chi_Minh (UTC+7) — đặt trong `vitest.config.ts`.

describe('formatDate', () => {
  it('hiện dd/mm/yyyy', () => {
    expect(formatDate('2026-08-11')).toBe('11/08/2026')
  })

  it('chuỗi chỉ có NGÀY thì không được xê dịch múi giờ', () => {
    // Đây là lỗi kinh điển: quy đổi ngày trần sang giờ địa phương làm mất/thêm
    // một ngày (hạn giao 01/09 thành 31/08).
    expect(formatDate('2026-01-01')).toBe('01/01/2026')
    expect(formatDate('2026-12-31')).toBe('31/12/2026')
  })

  it('nhận cả đối tượng Date', () => {
    expect(formatDate(new Date(2026, 7, 11))).toBe('11/08/2026')
  })

  it('trả rỗng khi không có giá trị hoặc giá trị hỏng', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('không phải ngày')).toBe('')
    expect(formatDate(new Date('x'))).toBe('')
  })
})

describe('formatDateTime', () => {
  it('mốc thời gian TRẦN của backend được hiểu là UTC rồi đổi sang giờ VN', () => {
    // Backend lưu UTC nhưng trả chuỗi không có `Z`. Không gắn `Z` thì mọi mốc
    // trong nhật ký thao tác lệch đúng 7 tiếng.
    expect(formatDateTime('2026-08-11T09:30:00')).toBe('11/08/2026 16:30')
  })

  it('qua nửa đêm thì ngày cũng phải nhảy theo', () => {
    expect(formatDateTime('2026-08-11T18:00:00')).toBe('12/08/2026 01:00')
  })

  it('chuỗi ĐÃ có múi giờ thì để nguyên, không cộng thêm lần nữa', () => {
    expect(formatDateTime('2026-08-11T09:30:00+07:00')).toBe('11/08/2026 09:30')
    expect(formatDateTime('2026-08-11T09:30:00Z')).toBe('11/08/2026 16:30')
  })

  it('trả rỗng khi không có giá trị', () => {
    expect(formatDateTime(null)).toBe('')
  })
})

describe('formatTime', () => {
  it('bù múi giờ y như formatDateTime, chỉ bỏ phần ngày', () => {
    expect(formatTime('2026-08-11T09:30:00')).toBe('16:30')
  })

  it('luôn 24 giờ và luôn hai chữ số — cột giờ phải thẳng hàng', () => {
    // `vi-VN` mặc định có thể trả "07:05" hoặc "7:05 SA" tùy môi trường; cột
    // giờ của tab Hoạt động lệch một ký tự là cả dải dòng so le.
    expect(formatTime('2026-08-11T00:05:00')).toBe('07:05')
    expect(formatTime('2026-08-11T17:00:00')).toBe('00:00')
  })

  it('trả rỗng khi không có giá trị hoặc giá trị hỏng', () => {
    expect(formatTime(null)).toBe('')
    expect(formatTime('không phải ngày')).toBe('')
  })
})

describe('toDateInputValue', () => {
  it('giữ nguyên ngày cho <input type="date">, không lùi một ngày', () => {
    expect(toDateInputValue('2026-08-11')).toBe('2026-08-11')
    expect(toDateInputValue(new Date(2026, 7, 11))).toBe('2026-08-11')
  })

  it('mốc thời gian đầu ngày theo giờ VN vẫn ra đúng ngày đó', () => {
    // 2026-08-10T18:00Z = 11/08 01:00 giờ VN -> phải là 2026-08-11.
    expect(toDateInputValue('2026-08-10T18:00:00')).toBe('2026-08-11')
  })

  it('trả rỗng khi không có giá trị', () => {
    expect(toDateInputValue(null)).toBe('')
    expect(toDateInputValue('lung tung')).toBe('')
  })
})

describe('formatRelativeTime', () => {
  // Mốc "bây giờ" cố định: 27/08/2026 17:00 giờ VN = 10:00 UTC.
  const now = new Date('2026-08-27T10:00:00Z')

  it('leo thang theo độ xa: vừa xong, phút, giờ, ngày, tuần, tháng', () => {
    expect(formatRelativeTime('2026-08-27T09:59:40', now)).toBe('Vừa xong')
    expect(formatRelativeTime('2026-08-27T09:55:00', now)).toBe('5 phút trước')
    expect(formatRelativeTime('2026-08-27T07:00:00', now)).toBe('3 giờ trước')
    expect(formatRelativeTime('2026-08-25T10:00:00', now)).toBe('2 ngày trước')
    expect(formatRelativeTime('2026-08-18T10:00:00', now)).toBe('1 tuần trước')
    expect(formatRelativeTime('2026-07-20T10:00:00', now)).toBe('1 tháng trước')
  })

  it('quá ~2 tháng thì thôi đếm, hiện thẳng ngày', () => {
    expect(formatRelativeTime('2026-05-01T10:00:00', now)).toBe('01/05/2026')
  })

  it('mốc TƯƠNG LAI quá 5 phút là dữ liệu hỏng — hiện ngày giờ cho lộ ra', () => {
    // Không được ra "-30 phút trước"; lệch nhỏ vài phút (giờ máy chưa khớp) thì
    // vẫn coi là "Vừa xong".
    expect(formatRelativeTime('2026-08-27T10:30:00', now)).toBe('27/08/2026 17:30')
    expect(formatRelativeTime('2026-08-27T10:02:00', now)).toBe('Vừa xong')
  })

  it('chuỗi TRẦN của backend được hiểu là UTC như mọi hàm khác trong tệp này', () => {
    // 09:00 trần = 16:00 giờ VN, tức 1 giờ trước mốc 17:00 — không phải 8 giờ.
    expect(formatRelativeTime('2026-08-27T09:00:00', now)).toBe('1 giờ trước')
  })

  it('trả rỗng khi không có giá trị', () => {
    expect(formatRelativeTime(null, now)).toBe('')
    expect(formatRelativeTime('hỏng', now)).toBe('')
  })
})

describe('formatWeekdayDate', () => {
  it('viết hoa chữ đầu mỗi từ của thứ', () => {
    // 12/08/2026 là thứ Tư.
    expect(formatWeekdayDate('2026-08-12')).toBe('Thứ Tư, 12.08.2026')
  })

  it('trả rỗng khi không có giá trị', () => {
    expect(formatWeekdayDate(undefined)).toBe('')
  })
})
