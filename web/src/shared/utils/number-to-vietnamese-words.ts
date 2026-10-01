const DIGITS = [
  'không',
  'một',
  'hai',
  'ba',
  'bốn',
  'năm',
  'sáu',
  'bảy',
  'tám',
  'chín',
] as const

const SCALES = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ'] as const

/**
 * Đọc số tiền thành chữ tiếng Việt cho bản in ("Số tiền viết bằng chữ").
 *
 * Làm tròn về ĐỒNG trước khi đọc: chứng từ kế toán không ghi phần lẻ, mà đơn giá
 * ở hệ thống giữ tới 4 số thập phân nên tổng tiền thường có đuôi lẻ.
 */
export function numberToVietnameseWords(amount: number): string {
  let remaining = Math.round(Number(amount) || 0)
  if (remaining <= 0) return 'Không đồng'

  const groups: number[] = []
  while (remaining > 0) {
    groups.push(remaining % 1000)
    remaining = Math.floor(remaining / 1000)
  }

  const parts: string[] = []
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index] === 0) continue
    // Nhóm không phải nhóm cao nhất thì luôn đọc đủ hàng trăm ("một triệu KHÔNG
    // TRĂM năm mươi nghìn"), bỏ đi là đọc sai bậc.
    parts.push(readTriple(groups[index], index < groups.length - 1) + SCALES[index])
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1) + ' đồng chẵn'
}

function readTriple(value: number, forceHundred: boolean): string {
  const hundred = Math.floor(value / 100)
  const ten = Math.floor((value % 100) / 10)
  const unit = value % 10
  const parts: string[] = []

  if (forceHundred || hundred > 0) parts.push(`${DIGITS[hundred]} trăm`)

  if (ten === 0) {
    if (unit > 0) parts.push((forceHundred || hundred > 0 ? 'lẻ ' : '') + DIGITS[unit])
  } else if (ten === 1) {
    parts.push('mười')
    if (unit === 5) parts.push('lăm')
    else if (unit > 0) parts.push(DIGITS[unit])
  } else {
    parts.push(`${DIGITS[ten]} mươi`)
    if (unit === 1) parts.push('mốt')
    else if (unit === 5) parts.push('lăm')
    else if (unit > 0) parts.push(DIGITS[unit])
  }

  return parts.join(' ')
}
