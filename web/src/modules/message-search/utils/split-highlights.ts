/** Một mẩu chữ của đoạn trích: `match` = phần trùng từ khóa (tô sáng). */
export interface HighlightPart {
  text: string
  match: boolean
}

/** Bỏ dấu + chữ thường TỪNG ký tự, giữ nguyên số ký tự để vị trí trên bản gấp dùng được cho chuỗi gốc. */
function foldEachChar(chars: string[]): string[] {
  return chars.map((char) => {
    const folded = char.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    return folded.length === 1 ? folded : (folded[0] ?? ' ')
  })
}

/** Từ khóa người gõ: cụm trong ngoặc kép giữ nguyên, còn lại tách theo khoảng trắng (khớp cách máy chủ tách). */
function searchTerms(query: string): string[] {
  const terms: string[] = []
  const quoted = /"([^"]+)"/g
  for (const match of query.matchAll(quoted)) terms.push(match[1])
  for (const word of query.replace(quoted, ' ').split(/\s+/)) terms.push(word)
  // Toàn dấu câu / emoji không phải từ khóa (máy chủ cũng bỏ) — giữ lại thì tô sáng lung tung mọi dấu chấm
  return terms.map((term) => term.replace(/[+\-<>()~*"@]/g, ' ').trim()).filter((term) => /[\p{L}\p{N}]/u.test(term))
}

/**
 * Cắt đoạn trích thành các mẩu, đánh dấu chỗ trùng từ khóa — không phân biệt dấu / hoa thường («cong no» tô sáng «Công
 * nợ»), giữ nguyên chữ gốc để hiện. Hàm thuần.
 */
export function splitHighlights(text: string, query: string): HighlightPart[] {
  const chars = Array.from(text.normalize('NFC'))
  const folded = foldEachChar(chars)
  const marked = new Array<boolean>(chars.length).fill(false)
  for (const term of searchTerms(query.normalize('NFC'))) {
    const needle = foldEachChar(Array.from(term))
    for (let start = 0; start + needle.length <= folded.length; start += 1) {
      if (needle.every((char, offset) => folded[start + offset] === char)) {
        for (let offset = 0; offset < needle.length; offset += 1) marked[start + offset] = true
      }
    }
  }
  const parts: HighlightPart[] = []
  chars.forEach((char, index) => {
    const last = parts[parts.length - 1]
    if (last && last.match === marked[index]) last.text += char
    else parts.push({ text: char, match: marked[index] })
  })
  return parts
}
