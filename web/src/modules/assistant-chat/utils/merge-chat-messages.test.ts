import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../types/assistant-chat'
import { createOptimisticQuestion, mergeChatMessages, OPTIMISTIC_MESSAGE_ID } from './merge-chat-messages'

function message(id: number, role: ChatMessage['role'] = 'user', text = `tin ${id}`): ChatMessage {
  return { id, role, text, sent_at: '2026-10-06T09:00:00+07:00', file: null }
}

describe('createOptimisticQuestion', () => {
  it('tags the placeholder with the sentinel id so it can be found and dropped later', () => {
    const optimistic = createOptimisticQuestion('hỏi thử', '2026-10-06T09:00:00+07:00')
    expect(optimistic).toEqual({
      id: OPTIMISTIC_MESSAGE_ID,
      role: 'user',
      text: 'hỏi thử',
      sent_at: '2026-10-06T09:00:00+07:00',
      file: null,
    })
  })
})

describe('mergeChatMessages', () => {
  it('drops the optimistic placeholder and appends the real question + answer in order', () => {
    const current = [message(1), message(2), createOptimisticQuestion('đang hỏi')]
    const incoming = [message(3), message(4, 'assistant')]
    expect(mergeChatMessages(current, incoming)).toEqual([message(1), message(2), message(3), message(4, 'assistant')])
  })

  it('does not duplicate a message id already present (retry after a failed send)', () => {
    const current = [message(1), message(2), message(3)]
    const incoming = [message(3), message(4)]
    expect(mergeChatMessages(current, incoming)).toEqual([message(1), message(2), message(3), message(4)])
  })

  it('returns the current list unchanged (minus optimistic) when incoming is empty', () => {
    expect(mergeChatMessages([message(1), createOptimisticQuestion('x')], [])).toEqual([message(1)])
  })

  it('returns incoming as-is when current is empty', () => {
    expect(mergeChatMessages([], [message(1), message(2)])).toEqual([message(1), message(2)])
  })

  it('handles an incoming list that itself has duplicate ids by keeping only the first', () => {
    const current: ChatMessage[] = []
    const incoming = [message(1), { ...message(1), text: 'bản khác' }]
    expect(mergeChatMessages(current, incoming)).toEqual([message(1)])
  })

  it('is a no-op on two empty lists', () => {
    expect(mergeChatMessages([], [])).toEqual([])
  })
})
