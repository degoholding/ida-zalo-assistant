import { describe, expect, it } from 'vitest'

import { describeListError } from './describe-list-error'

const axiosError = (status: number, message?: string) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data: { success: false, error: { code: 'x', message } } },
})

describe('describeListError', () => {
  // Review 09/10/2026: màn Tìm tin trả 422 «Tìm lâu quá — thêm từ khóa…» nhưng bảng hiện
  // «Kiểm tra kết nối hoặc quyền truy cập» — người dùng đi kiểm mạng thay vì thu hẹp từ khóa
  it('shows the server-written guidance when the server rejects the request itself (422)', () => {
    expect(describeListError(axiosError(422, 'Tìm lâu quá — thêm từ khóa cụ thể hơn.'))).toBe(
      'Tìm lâu quá — thêm từ khóa cụ thể hơn.',
    )
  })

  it('keeps the default table message for network, server and permission failures', () => {
    expect(describeListError(axiosError(500, 'Lỗi máy chủ'))).toBeUndefined()
    expect(describeListError(axiosError(403, 'Không có quyền'))).toBeUndefined()
    expect(describeListError(new Error('Network Error'))).toBeUndefined()
  })

  it('does not throw on a missing or odd error value', () => {
    expect(describeListError(null)).toBeUndefined()
    expect(describeListError(undefined)).toBeUndefined()
    expect(describeListError('boom')).toBeUndefined()
  })

  it('still yields readable text when a 422 carries no message', () => {
    expect(describeListError({ response: { status: 422, data: {} } })).toBeTruthy()
  })
})
