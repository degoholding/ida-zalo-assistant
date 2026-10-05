import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import { SecretSettingField } from './secret-setting-field'
import type { SettingFormValues, SettingView } from '../types/setting'

function makeSetting(overrides: Partial<SettingView>): SettingView {
  return {
    key: 'gemini_api_key', group: 'assistant', label: 'Khóa Gemini', help: 'Khóa API Google Gemini.',
    type: 'string', secret: true, value: null, is_set: true, hint: '…wxyz',
    source: 'web', env_value: null, default_value: null, min: null, max: 200, max_length: 200, allow_empty: false,
    ...overrides,
  }
}

function Harness({ setting, onDelete }: { setting: SettingView; onDelete?: () => void }) {
  // Ô bí mật LUÔN khởi tạo rỗng trên form — không khác gì cách trang thật dựng giá trị mặc định.
  const { control } = useForm<SettingFormValues>({ defaultValues: { [setting.key]: '' } })
  return <SecretSettingField setting={setting} control={control} onDelete={onDelete ?? vi.fn()} />
}

describe('SecretSettingField', () => {
  it('đã đặt thì chỉ hiện "Đã đặt · <hint>", KHÔNG có ô nhập nào lộ giá trị thật', () => {
    render(<Harness setting={makeSetting({ is_set: true, hint: '…wxyz' })} />)
    expect(screen.getByText('Đã đặt · …wxyz')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('bấm Đổi mở ô nhập TRỐNG — giá trị cũ không bao giờ lọt vào DOM', async () => {
    render(<Harness setting={makeSetting({ is_set: true, hint: '…wxyz' })} />)
    await userEvent.click(screen.getByRole('button', { name: /Đổi/ }))
    const input = screen.getByPlaceholderText('Dán giá trị mới') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('chưa đặt thì hiện thẳng ô nhập, không có nút Xóa hay dòng "Đã đặt"', () => {
    render(<Harness setting={makeSetting({ is_set: false, hint: '' })} />)
    expect(screen.queryByText(/Đã đặt/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa/ })).toBeNull()
    expect(screen.getByPlaceholderText('Dán giá trị mới')).toBeInTheDocument()
  })

  it('khóa service account (kiểu json) dùng ô nhiều dòng, không phải ô một dòng', () => {
    render(<Harness setting={makeSetting({ key: 'google_service_account_json', type: 'json', is_set: false, hint: '' })} />)
    expect(screen.getByPlaceholderText('Dán nguyên nội dung tệp .json').tagName).toBe('TEXTAREA')
  })

  it('không có gợi ý (hint rỗng) thì không vẽ nút chép', () => {
    render(<Harness setting={makeSetting({ is_set: true, hint: '' })} />)
    expect(screen.getByText('Đã đặt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Chép/ })).toBeNull()
  })
  // Lỗi thấy khi kiểm tay 03/10/2026: khóa lấy từ .env vẫn có nút Xóa, bấm thì không có gì xảy ra
  it('hides the delete button for a key that comes from .env and says where it comes from', () => {
    render(<Harness setting={makeSetting({ source: 'env', is_set: true, hint: '…wxyz' })} />)
    expect(screen.queryByRole('button', { name: /Xóa/ })).toBeNull()
    expect(screen.getByText(/từ \.env/)).toBeInTheDocument()
  })

  it('only offers a copy button for the service account email, never for the Gemini key hint', () => {
    const { unmount } = render(<Harness setting={makeSetting({ hint: '…wxyz' })} />)
    expect(screen.queryByRole('button', { name: /chép|copy/i })).toBeNull()
    unmount()
    render(<Harness setting={makeSetting({ key: 'google_service_account_json', type: 'json', hint: 'bot@demo.iam.gserviceaccount.com' })} />)
    expect(screen.getByRole('button', { name: /chép|copy/i })).toBeInTheDocument()
  })
})
