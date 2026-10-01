import { describe, expect, it } from 'vitest'

import { isBlankHtml } from './is-blank-html'

describe('isBlankHtml', () => {
  //  Lỗi thật: đổi `<textarea>` sang trình soạn thảo thì ô "chưa gõ gì" không
  //  còn là chuỗi rỗng nữa. Kiểm bằng `html.trim()` là nút Lưu sáng lên và
  //  người dùng tạo được bản trích rỗng ruột.
  it('trình soạn thảo chưa gõ gì vẫn tính là rỗng', () => {
    expect(isBlankHtml('<p></p>')).toBe(true)
    expect(isBlankHtml('<p><br></p>')).toBe(true)
    expect(isBlankHtml('<p>&nbsp;</p>')).toBe(true)
  })

  it('không có gì thì rỗng', () => {
    expect(isBlankHtml('')).toBe(true)
    expect(isBlankHtml(null)).toBe(true)
    expect(isBlankHtml(undefined)).toBe(true)
  })

  it('có chữ thì không rỗng', () => {
    expect(isBlankHtml('<p>Điều 5</p>')).toBe(false)
  })

  //  Một bản trích chỉ gồm bảng phụ cấp là chuyện bình thường — chặn lại là
  //  chặn nhầm đúng cái nghiệp vụ hay dùng nhất.
  it('chỉ có bảng hoặc ảnh thì vẫn là có nội dung', () => {
    expect(isBlankHtml('<table><tr><td></td></tr></table>')).toBe(false)
    expect(isBlankHtml('<p><img src="x.png"></p>')).toBe(false)
  })

  it('không dính chữ của hai khối liền nhau thành một từ', () => {
    //  Nếu bỏ thẻ mà không chèn khoảng trắng thì "a" + "b" thành "ab"; đây là
    //  cái bẫy làm hàm vẫn "chạy đúng" nhưng sai ở chỗ khác dùng lại nó.
    expect(isBlankHtml('<p>a</p><p>b</p>')).toBe(false)
  })
})
