import { describe, expect, it } from 'vitest'

import { MAX_IMAGE_BYTES, validateImageFile } from './image-file'

/** Tạo File giả có đúng `type` và `size` cần kiểm. */
function fakeFile(type: string, size: number): File {
  const file = new File(['x'], 'anh.png', { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('validateImageFile', () => {
  it('chấp nhận ảnh đúng kiểu và trong giới hạn', () => {
    expect(validateImageFile(fakeFile('image/png', 1024))).toBeNull()
  })

  it('từ chối tệp không phải ảnh', () => {
    expect(validateImageFile(fakeFile('application/pdf', 1024))).toMatch(/tệp ảnh/)
  })

  it('từ chối ảnh vượt dung lượng', () => {
    expect(validateImageFile(fakeFile('image/jpeg', MAX_IMAGE_BYTES + 1))).toMatch(/tối đa/)
  })

  it('đúng bằng giới hạn thì vẫn cho qua', () => {
    expect(validateImageFile(fakeFile('image/jpeg', MAX_IMAGE_BYTES))).toBeNull()
  })
})
