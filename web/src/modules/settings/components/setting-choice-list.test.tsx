import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { SettingChoice } from '../types/setting'
import { SettingChoiceList } from './setting-choice-list'

const CHOICES: SettingChoice[] = [
  { value: 'pdf', label: 'pdf', group: 'Văn bản' },
  { value: 'mp3', label: 'mp3', group: 'Ghi âm (gỡ băng + tóm tắt)' },
]

describe('SettingChoiceList', () => {
  it('renders one checkbox per choice under its group, ticked from the current value', () => {
    render(<SettingChoiceList id="types" choices={CHOICES} value="mp3" onChange={vi.fn()} />)
    expect(screen.getByText('Văn bản')).toBeInTheDocument()
    expect(screen.getByText('Ghi âm (gỡ băng + tóm tắt)')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'pdf' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'mp3' })).toBeChecked()
  })

  it('ticking a box reports the new comma list', async () => {
    const onChange = vi.fn()
    render(<SettingChoiceList id="types" choices={CHOICES} value="mp3" onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'pdf' }))
    expect(onChange).toHaveBeenCalledWith('pdf, mp3')
  })

  it('disabled boxes cannot be toggled', async () => {
    const onChange = vi.fn()
    render(<SettingChoiceList id="types" choices={CHOICES} value="" onChange={onChange} disabled />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'pdf' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
