import type { CSSProperties } from 'react'

export interface ColumnColor {
  id: string
  label: string
  /** Màu gốc — chỉ dùng để pha, không bao giờ tô nguyên độ đậm này lên ô. */
  value: string
}

/**
 * Bảng màu cho phép tô cột.
 *
 * Dùng mã màu cứng chứ không dùng token ngữ nghĩa (`--warning`, `--success`…):
 * đây là màu người dùng tự chọn để ĐÁNH DẤU cột cho dễ dò, không mang nghĩa
 * "cảnh báo" hay "thành công" nào cả. Tám tông lấy đúng bảng màu đang dùng cho
 * huy hiệu tiến độ để cả hệ nhìn cùng một gam.
 */
export const COLUMN_COLORS: ColumnColor[] = [
  { id: 'blue', label: 'Xanh dương', value: '#2563eb' },
  { id: 'cyan', label: 'Xanh ngọc', value: '#0891b2' },
  { id: 'green', label: 'Xanh lá', value: '#16a34a' },
  { id: 'amber', label: 'Vàng', value: '#d97706' },
  { id: 'orange', label: 'Cam', value: '#ea580c' },
  { id: 'red', label: 'Đỏ', value: '#dc2626' },
  { id: 'pink', label: 'Hồng', value: '#db2777' },
  { id: 'violet', label: 'Tím', value: '#7c3aed' },
]

const BY_ID = new Map(COLUMN_COLORS.map((color) => [color.id, color]))

/** Màu tự chọn được lưu thẳng dưới dạng mã hex (`#1a2b3c`), không có trong bảng trên. */
export function isCustomColor(id?: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(id || '')
}

export function findColumnColor(id?: string): ColumnColor | undefined {
  if (isCustomColor(id)) return { id: id as string, label: 'Màu tùy chỉnh', value: id as string }
  return id ? BY_ID.get(id) : undefined
}

/**
 * Nền của ô thuộc cột đã tô màu.
 *
 * Tô bằng một LỚP PHỦ mờ (`background-image` một màu phẳng) chồng lên nền sẵn
 * có của ô, KHÔNG ghi đè `background-color`.
 *
 * ⚠️ Trước đây hàm này trả `backgroundColor: color-mix(màu, var(--muted))` cho ô
 * tiêu đề và `color-mix(màu, var(--card))` cho ô thân — tức tự đoán lấy nền phía
 * dưới. Đoán sai ở cả hai chỗ:
 * - Hàng tiêu đề nay chạy trên `--row-head`, không phải `--muted` (DEGO: #dbe6f5
 *   so với #f6f8fb). Cột được tô nằm trên một nền trắng hơn hẳn các cột bên
 *   cạnh, nên nhìn ra thành "hàng tiêu đề có hai màu" chứ không ra "cột này
 *   được đánh dấu" (lỗi thấy được 27/08/2026).
 * - Ô thân luôn pha vào `--card`, nên cột được tô phớt lờ vằn hàng chẵn lẻ, nền
 *   hàng đang rê chuột và hàng đang chọn.
 *
 * Lớp phủ thì không phải đoán gì cả: nền thật của ô nằm dưới, sắc màu đánh dấu
 * nằm trên, nên cột tô màu vẫn ăn theo vằn hàng và hover.
 *
 * Ô vẫn ĐỤC như cũ — điều kiện bắt buộc vì ô của cột ghim đè lên phần bảng đang
 * cuộn ngang phía dưới. Độ đục do `background-color` của chính ô lo (`bg-row-head`
 * ở tiêu đề, `bg-inherit` ở ô ghim); lớp phủ này chỉ nhuộm thêm màu lên trên.
 */
export function columnColorStyle(
  colorId: string | undefined,
  part: 'head' | 'cell',
): CSSProperties | undefined {
  const color = findColumnColor(colorId)
  if (!color) return undefined

  //  Tiêu đề đậm hơn thân bảng: nó là chỗ người dùng dò để tìm cột, còn thân
  //  bảng chỉ cần một sắc phớt đủ dẫn mắt xuống mà không lấn chữ.
  const alpha = part === 'head' ? '20%' : '10%'
  const overlay = `color-mix(in oklab, ${color.value} ${alpha}, transparent)`
  //  `linear-gradient` một màu phẳng là cách duy nhất đặt được MỘT lớp màu qua
  //  `background-image` — CSS không có thuộc tính "lớp phủ" riêng.
  return { backgroundImage: `linear-gradient(${overlay}, ${overlay})` }
}
