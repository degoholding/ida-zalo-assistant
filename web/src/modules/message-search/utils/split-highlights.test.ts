import { describe, expect, it } from 'vitest'

import { splitHighlights } from './split-highlights'

const marked = (text: string, query: string) =>
  splitHighlights(text, query).filter((part) => part.match).map((part) => part.text)

describe('splitHighlights', () => {
  it('highlights terms regardless of accents and case, keeping the original text', () => {
    // Mỗi từ tô riêng, khoảng trắng giữa hai từ không tô
    expect(marked('Khách Minh Phát còn NỢ 420 triệu', 'cong no minh phat')).toEqual(['Minh', 'Phát', 'NỢ'])
    expect(splitHighlights('Công nợ', 'nợ').map((part) => part.text).join('')).toBe('Công nợ')
  })

  it('treats a quoted phrase as one term and ignores boolean operator characters', () => {
    // Cụm trong ngoặc kép tô liền một khối (cả khoảng trắng bên trong); «-» / «*» không làm hỏng từ «thép»
    expect(marked('ký hợp đồng thép hôm nay', '"hợp đồng" -thép*')).toEqual(['hợp đồng', 'thép'])
  })

  it('returns one plain part when the query is empty or nothing matches', () => {
    expect(splitHighlights('Tin ngắn', '')).toEqual([{ text: 'Tin ngắn', match: false }])
    expect(splitHighlights('Tin ngắn', 'không có')).toEqual([{ text: 'Tin ngắn', match: false }])
    // Từ khóa toàn dấu câu không tô các dấu chấm trong tin
    expect(splitHighlights('Giá... ổn.', '...')).toEqual([{ text: 'Giá... ổn.', match: false }])
  })

  it('keeps emoji and other multi-unit characters intact around a match', () => {
    expect(splitHighlights('😀 "đại lý"', '"dai ly"')).toEqual([
      { text: '😀 "', match: false }, { text: 'đại lý', match: true }, { text: '"', match: false },
    ])
  })
})
