import { describe, expect, it } from 'vitest'

import type { SettingChoice } from '../types/setting'
import { groupChoices, parseChoiceList, toggleChoice } from './toggle-choice-list'

const CHOICES: SettingChoice[] = [
  { value: 'pdf', label: 'pdf', group: 'Văn bản' },
  { value: 'docx', label: 'docx', group: 'Văn bản' },
  { value: 'jpg', label: 'jpg', group: 'Ảnh' },
  { value: 'mp3', label: 'mp3', group: 'Ghi âm' },
]

describe('toggle-choice-list', () => {
  it('reads the comma string leniently: spaces, case, leading dots, blanks', () => {
    expect([...parseChoiceList(' PDF, .mp3,, docx ')]).toEqual(['pdf', 'mp3', 'docx'])
    expect(parseChoiceList(undefined).size).toBe(0)
    expect(parseChoiceList(42).size).toBe(0)
  })

  it('ticking adds the choice and keeps the list in choice order', () => {
    expect(toggleChoice('mp3, pdf', CHOICES, 'jpg', true)).toBe('pdf, jpg, mp3')
  })

  it('unticking removes the choice; ticking it back restores the same string so the form is not dirty', () => {
    const start = 'pdf, docx, mp3'
    const removed = toggleChoice(start, CHOICES, 'docx', false)
    expect(removed).toBe('pdf, mp3')
    expect(toggleChoice(removed, CHOICES, 'docx', true)).toBe(start)
  })

  it('drops unknown extensions and handles an empty list', () => {
    expect(toggleChoice('pdf, mp4, exe', CHOICES, 'mp3', true)).toBe('pdf, mp3')
    expect(toggleChoice('', CHOICES, 'pdf', false)).toBe('')
    expect(toggleChoice('pdf', CHOICES, 'pdf', false)).toBe('')
  })

  it('groups choices in order of first appearance', () => {
    expect(groupChoices(CHOICES).map((entry) => [entry.group, entry.items.length])).toEqual([
      ['Văn bản', 2],
      ['Ảnh', 1],
      ['Ghi âm', 1],
    ])
  })
})
