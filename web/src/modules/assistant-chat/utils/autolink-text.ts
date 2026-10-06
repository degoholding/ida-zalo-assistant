export interface TextSegment {
  type: 'text' | 'link'
  value: string
}

/** Chỉ nhận http/https — không khớp `javascript:`, `data:`… nên không có chuyện tự chèn link chạy mã. */
const URL_PATTERN = /https?:\/\/[^\s<>"]+/gi

/** Dấu câu / ngoặc đóng hay đứng NGAY SAU một URL trong câu, không phải một phần của đường dẫn. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"'])
const CLOSING_TO_OPENING: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/**
 * Bóc dấu câu / ngoặc đóng không khớp ở cuối URL. Ngoặc đóng chỉ bóc khi KHÔNG
 * khớp một ngoặc mở nào trong chính URL — «(xem https://a.com/b(1))» giữ lại
 * `b(1)` vì ngoặc đó mở bên trong URL, chỉ bóc cái `)` thừa cuối cùng.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    const opening = CLOSING_TO_OPENING[ch]
    if (opening) {
      const scanned = url.slice(0, end)
      const opens = scanned.split(opening).length - 1
      const closes = scanned.split(ch).length - 1
      if (closes > opens) {
        end -= 1
        continue
      }
      break
    }
    if (TRAILING_PUNCTUATION.has(ch)) {
      end -= 1
      continue
    }
    break
  }
  return url.slice(0, end)
}

/**
 * Cắt một đoạn chữ thành các đoạn chữ thường / đường dẫn để React tự render `<a>`
 * — KHÔNG dùng `dangerouslySetInnerHTML` (tránh chèn mã qua câu trả lời của mô hình).
 */
export function autolinkText(text: string): TextSegment[] {
  if (!text) return []
  const segments: TextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ type: 'text', value: text.slice(cursor, start) })
    const trimmed = trimTrailingPunctuation(match[0])
    if (!trimmed) {
      // Toàn dấu câu dính liền chữ `http`, không còn gì ra một URL thật — giữ nguyên là chữ thường
      segments.push({ type: 'text', value: match[0] })
      cursor = start + match[0].length
      continue
    }
    segments.push({ type: 'link', value: trimmed })
    cursor = start + trimmed.length
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  return segments
}
