import { describe, expect, it } from 'vitest'

import { sanitizeHtml } from './sanitize-html'

/**
 * Lớp phòng thủ THỨ HAI cho XSS lưu trữ. Backend đã lọc lúc GHI, nhưng dữ liệu
 * cũ (lưu trước ngày bật bộ lọc) và mọi đường ghi lỡ sót vẫn tới trình duyệt —
 * đã dựng lại được: ghi thẳng `<img src=x onerror=...>` vào DB rồi mở trang in
 * thì `onerror` chạy trong phiên người mở (26/08/2026). Người mở bản in thường
 * là cấp trên đi duyệt.
 */
describe('sanitizeHtml', () => {
  it('rỗng / null / undefined trả chuỗi rỗng', () => {
    expect(sanitizeHtml('')).toBe('')
    expect(sanitizeHtml(null)).toBe('')
    expect(sanitizeHtml(undefined)).toBe('')
  })

  it.each([
    ['img onerror', '<img src=x onerror="steal()">', 'onerror'],
    ['thẻ script', '<p>a</p><script>steal()</script>', '<script'],
    ['href javascript:', '<a href="javascript:steal()">x</a>', 'javascript:'],
    ['svg onload', '<svg onload="steal()"></svg>', 'onload'],
    ['iframe srcdoc', '<iframe srcdoc="<script>steal()</script>"></iframe>', 'srcdoc'],
    ['onmouseover', '<div onmouseover="steal()">x</div>', 'onmouseover'],
    ['body onload', '<body onload="steal()">x', 'onload'],
  ])('cắt %s', (_nhan, payload, cam) => {
    expect(sanitizeHtml(payload).toLowerCase()).not.toContain(cam.toLowerCase())
  })

  it('KHÔNG còn lời gọi hàm độc dù có xóa thẻ', () => {
    //  Cắt `onerror` không được để lại `steal()` chạy được bằng đường khác.
    const out = sanitizeHtml('<img src=x onerror="steal()">')
    expect(out).not.toContain('onerror')
  })

  it('GIỮ định dạng lành: đậm, nghiêng, bảng, tiêu đề', () => {
    const lanh = '<h1>Điều 1</h1><p><strong>Đậm</strong> <em>nghiêng</em></p><table><tr><td>ô</td></tr></table>'
    const out = sanitizeHtml(lanh)
    for (const tag of ['<h1>', '<strong>', '<em>', '<table>', '<td>']) {
      expect(out).toContain(tag)
    }
  })

  it('GIỮ ảnh dán inline data:image nhưng CẮT data:text/html', () => {
    expect(sanitizeHtml('<img src="data:image/png;base64,iVBOR">')).toContain('data:image/png')
    //  data:text/html là đường lách XSS — phải rớt.
    const doc = sanitizeHtml('<a href="data:text/html,<script>steal()</script>">x</a>')
    expect(doc.toLowerCase()).not.toContain('data:text/html')
    expect(doc.toLowerCase()).not.toContain('<script')
  })

  it('giữ liên kết http thường và chữ bên trong', () => {
    const out = sanitizeHtml('<a href="https://dego.vn">DEGO</a>')
    expect(out).toContain('href="https://dego.vn"')
    expect(out).toContain('DEGO')
  })
})
