import { describe, expect, it } from 'vitest'

import type { ChatMessage, MessagesPage } from '../types/conversation'
import { flattenMessagePages } from './use-conversations'

const message = (id: number) => ({ id, text: `tin ${id}` }) as ChatMessage
const page = (ids: number[]): MessagesPage => ({ items: ids.map(message), older_cursor: null, newer_cursor: null })

describe('flattenMessagePages', () => {
  it('shows pages oldest first: page 0 is the newest (or the around page), later pages are older', () => {
    expect(flattenMessagePages([page([7, 8]), page([4, 5, 6]), page([1, 2, 3])]).map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('drops a message repeated where two pages touch after a refetch, keeping the first copy', () => {
    expect(flattenMessagePages([page([5, 6]), page([4, 5]), page([4])]).map((item) => item.id)).toEqual([4, 5, 6])
  })

  it('handles no data and empty pages', () => {
    expect(flattenMessagePages(undefined)).toEqual([])
    expect(flattenMessagePages([page([]), page([])])).toEqual([])
  })
})
