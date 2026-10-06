import { describe, expect, it } from 'vitest'

import { autolinkText } from './autolink-text'

describe('autolinkText', () => {
  it('returns a single text segment when there is no URL', () => {
    expect(autolinkText('không có link nào ở đây')).toEqual([
      { type: 'text', value: 'không có link nào ở đây' },
    ])
  })

  it('returns an empty array for an empty string', () => {
    expect(autolinkText('')).toEqual([])
  })

  it('splits text around an http/https URL into text and link segments', () => {
    expect(autolinkText('xem tại https://example.com/a báo cáo')).toEqual([
      { type: 'text', value: 'xem tại ' },
      { type: 'link', value: 'https://example.com/a' },
      { type: 'text', value: ' báo cáo' },
    ])
  })

  it('excludes trailing sentence punctuation from the link', () => {
    expect(autolinkText('link: https://example.com/a.')).toEqual([
      { type: 'text', value: 'link: ' },
      { type: 'link', value: 'https://example.com/a' },
      { type: 'text', value: '.' },
    ])
    expect(autolinkText('xem https://example.com/a, rồi báo lại')).toEqual([
      { type: 'text', value: 'xem ' },
      { type: 'link', value: 'https://example.com/a' },
      { type: 'text', value: ', rồi báo lại' },
    ])
  })

  it('excludes an unmatched closing parenthesis but keeps balanced ones inside the URL', () => {
    expect(autolinkText('(xem https://example.com/a)')).toEqual([
      { type: 'text', value: '(xem ' },
      { type: 'link', value: 'https://example.com/a' },
      { type: 'text', value: ')' },
    ])
    expect(autolinkText('xem https://example.com/wiki/Foo_(bar)')).toEqual([
      { type: 'text', value: 'xem ' },
      { type: 'link', value: 'https://example.com/wiki/Foo_(bar)' },
    ])
  })

  it('never produces a javascript: link even when the text contains that scheme', () => {
    const segments = autolinkText('đừng bấm javascript:alert(1) nhé')
    expect(segments.some((segment) => segment.type === 'link')).toBe(false)
  })

  it('handles multiple URLs in the same message, each trimmed independently', () => {
    expect(autolinkText('so sánh https://a.com/1 và https://b.com/2.')).toEqual([
      { type: 'text', value: 'so sánh ' },
      { type: 'link', value: 'https://a.com/1' },
      { type: 'text', value: ' và ' },
      { type: 'link', value: 'https://b.com/2' },
      { type: 'text', value: '.' },
    ])
  })
})
