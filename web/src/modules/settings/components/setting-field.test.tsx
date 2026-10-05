import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import { SettingField } from './setting-field'
import type { SettingFormValues, SettingView } from '../types/setting'

function makeSetting(overrides: Partial<SettingView>): SettingView {
  return {
    key: 'gemini_model', group: 'assistant', label: 'Mô hình chính', help: 'Mô hình trả lời câu hỏi.',
    type: 'string', secret: false, value: 'gemini-3.5-flash-lite', is_set: true, hint: '',
    source: 'default', env_value: null, default_value: 'gemini-3.5-flash-lite',
    min: null, max: null, max_length: null, allow_empty: false,
    ...overrides,
  }
}

function Harness({ setting, onRestoreDefault }: { setting: SettingView; onRestoreDefault?: () => void }) {
  const { control } = useForm<SettingFormValues>({ defaultValues: { [setting.key]: setting.value as string } })
  return <SettingField setting={setting} control={control} onRestoreDefault={onRestoreDefault} />
}

describe('SettingField', () => {
  it('nguồn "mặc định" hiện kèm giá trị mặc định, không có nút khôi phục', () => {
    render(<Harness setting={makeSetting({ source: 'default' })} />)
    expect(screen.getByText('mặc định: gemini-3.5-flash-lite')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Khôi phục mặc định/ })).toBeNull()
  })

  it('nguồn "đặt trên web" hiện Pill «đặt trên web» kèm nút khôi phục khi có onRestoreDefault', () => {
    render(<Harness setting={makeSetting({ source: 'web' })} onRestoreDefault={vi.fn()} />)
    expect(screen.getByText('đặt trên web')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Khôi phục mặc định/ })).toBeInTheDocument()
  })

  it('nguồn ".env" hiện đúng giá trị .env, không lẫn giá trị mặc định', () => {
    render(<Harness setting={makeSetting({ source: 'env', env_value: 'gemini-flash-latest' })} />)
    expect(screen.getByText('từ .env: gemini-flash-latest')).toBeInTheDocument()
  })

  it('ô kiểu bool vẽ công tắc, không vẽ ô chữ', () => {
    render(<Harness setting={makeSetting({ key: 'default_group_read', type: 'bool', value: true, group: 'sync' })} />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('ô kiểu int vẽ ô số kèm min/max', () => {
    render(<Harness setting={makeSetting({ key: 'assistant_max_per_hour', type: 'int', value: 30, min: 1, max: 1000 })} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input).toHaveAttribute('min', '1')
    expect(input).toHaveAttribute('max', '1000')
  })
})
