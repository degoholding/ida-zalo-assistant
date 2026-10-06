import { describe, expect, it } from 'vitest'

import { shouldSubmitOnKeyDown } from './chat-composer-keys'

describe('shouldSubmitOnKeyDown', () => {
  it('submits on plain Enter', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
  })

  it('does not submit on Shift+Enter — that is a newline', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
  })

  it('does not submit on Enter while an IME composition is active', () => {
    // Gõ tiếng Việt kiểu Telex qua bộ gõ hệ điều hành: Enter lúc này chọn chữ, không gửi câu
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })

  it('does not submit on Shift+Enter while composing either', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: true, isComposing: true })).toBe(false)
  })

  it('ignores any other key', () => {
    expect(shouldSubmitOnKeyDown({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
    expect(shouldSubmitOnKeyDown({ key: 'Escape', shiftKey: false, isComposing: false })).toBe(false)
  })
})
