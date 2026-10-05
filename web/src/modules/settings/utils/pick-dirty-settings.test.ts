import { describe, expect, it } from 'vitest'

import { pickDirtySettings } from './pick-dirty-settings'

const SETTINGS = [
  { key: 'gemini_api_key', secret: true },
  { key: 'gemini_model', secret: false },
  { key: 'google_spreadsheet_url', secret: false },
]

describe('pickDirtySettings', () => {
  it('ô không đổi (dirty=false) không được gửi dù giá trị khác giá trị gốc', () => {
    const changes = pickDirtySettings(
      { gemini_api_key: '', gemini_model: 'khong-doi', google_spreadsheet_url: '' },
      { gemini_model: false },
      SETTINGS,
    )
    expect(changes).toEqual({})
  })

  it('ô bí mật để trống dù đã đổi (dirty=true) KHÔNG được gửi — trống nghĩa là giữ nguyên', () => {
    const changes = pickDirtySettings(
      { gemini_api_key: '', gemini_model: 'gemini-3.5-flash', google_spreadsheet_url: '' },
      { gemini_api_key: true, gemini_model: true },
      SETTINGS,
    )
    expect(changes).toEqual({ gemini_model: 'gemini-3.5-flash' })
  })

  it('ô bí mật có giá trị mới thì gửi nguyên văn', () => {
    const changes = pickDirtySettings(
      { gemini_api_key: 'khoa-moi', gemini_model: 'gemini-3.5-flash-lite', google_spreadsheet_url: '' },
      { gemini_api_key: true },
      SETTINGS,
    )
    expect(changes).toEqual({ gemini_api_key: 'khoa-moi' })
  })

  it('ô thường cho phép trống (vd link trang tính) mà người dùng xóa trắng vẫn được gửi — không bị coi như "bí mật trống"', () => {
    const changes = pickDirtySettings(
      { gemini_api_key: '', gemini_model: 'gemini-3.5-flash-lite', google_spreadsheet_url: '' },
      { google_spreadsheet_url: true },
      SETTINGS,
    )
    expect(changes).toEqual({ google_spreadsheet_url: '' })
  })

  it('danh sách cài đặt rỗng thì không gửi gì, không ném lỗi', () => {
    expect(pickDirtySettings({}, {}, [])).toEqual({})
  })
})
