import { isNeutral, measureColor } from './color-hue'

/**
 * TỪ MÀU TIẾNG VIỆT ↔ dải góc màu thật.
 *
 * Đây là nửa còn lại của phép kiểm mô tả bảng màu (xem `color-hue.ts`): có đo
 * được màu rồi thì còn phải quy ước "cam" nghĩa là góc màu bao nhiêu, không thì
 * mỗi người viết mô tả một kiểu.
 *
 * Dải cố ý CHỒNG NHAU ở chỗ mắt người cũng lưỡng lự (`chàm` 228–252 gối lên
 * `xanh dương` 200–258 và `tím` 248–300). Chồng nhau là đúng: `#6366f1` gọi
 * "chàm" hay "xanh dương" đều không sai, chỉ "tím" mới sai.
 */

interface ColorWord {
  /** Từ xuất hiện trong mô tả, viết thường. */
  word: string
  /**
   * Các dải góc màu chấp nhận được `[từ, đến)`. Đỏ có hai dải vì nó vắt qua 0°.
   * `null` = từ chỉ màu TRUNG TÍNH, kiểm bằng độ rực thay vì góc màu.
   */
  ranges: [number, number][] | null
  /** Yêu cầu thêm: dùng cho `nâu` — cùng góc với cam nhưng phải trầm và tối. */
  maxChroma?: number
  maxLightness?: number
}

/**
 * Thứ tự QUAN TRỌNG: dò theo thứ tự này nên từ dài phải đứng trước từ ngắn,
 * không thì "xanh lá" bị "xanh" nuốt mất. Vì vậy danh sách không có từ "xanh"
 * trần — mô tả phải nói rõ xanh gì.
 */
const COLOR_WORDS: ColorWord[] = [
  { word: 'xanh dương', ranges: [[200, 258]] },
  { word: 'xanh ngọc', ranges: [[155, 190]] },
  { word: 'xanh rêu', ranges: [[60, 110]] },
  { word: 'xanh lá', ranges: [[70, 155]] },
  { word: 'xanh lơ', ranges: [[180, 200]] },
  { word: 'hồng sẫm', ranges: [[298, 340]] },
  { word: 'trung tính', ranges: null },
  { word: 'đơn sắc', ranges: null },
  { word: 'chàm', ranges: [[228, 252]] },
  { word: 'tím', ranges: [[248, 300]] },
  { word: 'hồng', ranges: [[316, 352]] },
  { word: 'đỏ', ranges: [[352, 360], [0, 10]] },
  //  `nâu` = cam bị dìm độ rực và độ sáng. Không tách riêng thì `#a37764`
  //  (Mocha Mousse) và `#f59e0b` (Amber Minimal) cùng đội một tên, mà nhìn thì
  //  một bên là nâu đất còn một bên là vàng cam chói.
  { word: 'nâu', ranges: [[10, 42]], maxChroma: 0.5, maxLightness: 60 },
  { word: 'cam', ranges: [[10, 42]] },
  //  Bắt đầu từ 36 chứ không phải 42 để «hổ phách» (`#f59e0b`, H=38) gọi được
  //  là vàng — đúng tên gọi quen thuộc của màu amber, dù góc màu ngả sang cam.
  { word: 'vàng', ranges: [[36, 70]] },
  { word: 'xám', ranges: null },
  { word: 'đen', ranges: null },
  { word: 'trắng', ranges: null },
  { word: 'kem', ranges: null },
]

/** Từ màu đầu tiên xuất hiện trong `text`, hoặc `null` nếu không có từ nào. */
export function findFirstColorWord(text: string): ColorWord | null {
  const lower = text.toLowerCase()

  let best: { word: ColorWord; at: number } | null = null
  for (const word of COLOR_WORDS) {
    const at = lower.indexOf(word.word)
    if (at < 0) continue
    //  Từ đứng SỚM hơn thắng. Nhưng "xanh lá" và "lá" cùng bắt đầu ở một chỗ
    //  thì từ DÀI hơn thắng, vì nó cụ thể hơn.
    if (!best || at < best.at || (at === best.at && word.word.length > best.word.word.length)) {
      best = { word, at }
    }
  }
  return best?.word ?? null
}

/** Màu `hex` có đúng là màu mà `word` mô tả không. */
export function colorMatchesWord(hex: string, word: ColorWord): boolean {
  if (word.ranges === null) return isNeutral(hex)

  const { hue, chroma, lightness } = measureColor(hex)
  //  Màu quá nhạt thì góc màu chỉ là nhiễu — không thể gọi tên nó là màu gì.
  if (isNeutral(hex)) return false
  if (word.maxChroma !== undefined && chroma > word.maxChroma) return false
  if (word.maxLightness !== undefined && lightness > word.maxLightness) return false

  return word.ranges.some(([from, to]) => hue >= from && hue < to)
}

export type { ColorWord }
