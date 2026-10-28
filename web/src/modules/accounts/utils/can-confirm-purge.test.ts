import { describe, expect, it } from 'vitest'

import { canConfirmPurge } from './can-confirm-purge'

describe('canConfirmPurge', () => {
  it('only enables delete when the label is retyped exactly and backup is confirmed', () => {
    expect(canConfirmPurge('bot-thu', 'bot-thu', true)).toBe(true)
    expect(canConfirmPurge('bot-thu', 'bot-thu', false)).toBe(false)
  })

  it('rejects near matches: trailing space, different case, empty label', () => {
    expect(canConfirmPurge('bot-thu ', 'bot-thu', true)).toBe(false)
    expect(canConfirmPurge('BOT-THU', 'bot-thu', true)).toBe(false)
    expect(canConfirmPurge('', '', true)).toBe(false)
  })
})
