import { describe, expect, it } from 'vitest'

import { formatFileSize } from './format-file-size'

describe('formatFileSize', () => {
  it('dưới 1 MB thì đọc theo KB, làm tròn tới đơn vị', () => {
    expect(formatFileSize(443 * 1024)).toBe('443 KB')
    expect(formatFileSize(1536)).toBe('2 KB')
  })

  /** Tệp vài trăm byte hiện "0 KB" thì người dùng tưởng tải hỏng, tải lại lần nữa. */
  it('tệp bé hơn nửa KB vẫn hiện 1 KB chứ không hiện 0', () => {
    expect(formatFileSize(200)).toBe('1 KB')
  })

  it('từ 1 MB trở lên thì đọc theo MB, một số lẻ', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })

  it('không có dung lượng thì ghi 0 KB chứ không ra NaN', () => {
    expect(formatFileSize(0)).toBe('0 KB')
    expect(formatFileSize(Number.NaN)).toBe('0 KB')
  })
})
