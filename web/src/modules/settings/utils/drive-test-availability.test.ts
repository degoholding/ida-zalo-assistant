import { describe, expect, it } from 'vitest'

import { getDriveTestAvailability } from './drive-test-availability'

describe('getDriveTestAvailability', () => {
  it('khóa nút và nêu lý do khi chưa kết nối Google', () => {
    const result = getDriveTestAvailability({ connected: false, driveScopeGranted: false, folderSet: false })
    expect(result).toEqual({ disabled: true, reason: 'Chưa kết nối Google — kết nối ở mục Calendar & Meet phía trên' })
  })

  it('khóa nút khi đã kết nối nhưng chưa tick quyền Drive', () => {
    const result = getDriveTestAvailability({ connected: true, driveScopeGranted: false, folderSet: true })
    expect(result.disabled).toBe(true)
    expect(result.reason).toMatch(/quyền đọc Drive/)
  })

  it('khóa nút khi đã có quyền Drive nhưng chưa lưu link thư mục', () => {
    const result = getDriveTestAvailability({ connected: true, driveScopeGranted: true, folderSet: false })
    expect(result.disabled).toBe(true)
    expect(result.reason).toBe('Chưa có link thư mục ghi âm')
  })

  it('mở nút khi có đủ cả ba điều kiện, không kèm lý do khóa', () => {
    const result = getDriveTestAvailability({ connected: true, driveScopeGranted: true, folderSet: true })
    expect(result).toEqual({ disabled: false, reason: null })
  })

  it('ưu tiên báo "chưa kết nối" dù các điều kiện khác cũng thiếu — tránh người dùng sửa nhầm thứ chưa cần sửa', () => {
    const result = getDriveTestAvailability({ connected: false, driveScopeGranted: true, folderSet: true })
    expect(result.reason).toMatch(/Chưa kết nối Google/)
  })
})
