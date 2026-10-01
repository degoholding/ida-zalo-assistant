import { appConfig } from '@/core/config/app-config'

/**
 * ⚠️ KHÔNG gọi thẳng `toLocaleString('vi-VN')` lên số tiền: mặc định nó hiện 3 chữ số
 * thập phân, làm lẻ đồng rò ra cột danh sách (`4.760.000,08 đ`). Luôn dùng hai hàm dưới.
 * Đây chỉ là định dạng HIỂN THỊ — giá trị lưu trong DB vẫn giữ nguyên độ chính xác.
 */

const { locale } = appConfig

/** TIỀN (thành tiền, tổng cộng) — làm tròn tới đồng. */
export function formatMoney(value: number | string | null | undefined): string {
  const num = toNumber(value)
  if (num === null) return ''
  return num.toLocaleString(locale, { maximumFractionDigits: 0 })
}

/** ĐƠN GIÁ — giữ tối đa 4 chữ số thập phân, không ép đủ 4 nếu là số tròn. */
export function formatUnitPrice(value: number | string | null | undefined): string {
  const num = toNumber(value)
  if (num === null) return ''
  return num.toLocaleString(locale, { maximumFractionDigits: 4 })
}

/**
 * TỶ LỆ phần trăm — giữ tối đa 2 chữ số thập phân và tự gắn dấu `%`.
 *
 * Giá trị vào là SỐ PHẦN TRĂM (41.67 -> "41,67%"), không phải tỷ số 0–1: các
 * đường báo cáo đều đã nhân 100 và làm tròn 2 chữ số ở backend.
 */
export function formatPercent(value: number | string | null | undefined): string {
  const num = toNumber(value)
  if (num === null) return ''
  return `${num.toLocaleString(locale, { maximumFractionDigits: 2 })}%`
}

/**
 * Số kèm ĐƠN VỊ TIỀN: VND làm tròn tới đồng + "đ", ngoại tệ giữ số lẻ + mã tiền
 * (bao-CR-319: "5.230,5 USD" chứ không phải "5.230 đ"). Trống hiểu là VND.
 */
export function formatMoneyWithCurrency(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const code = (currency || 'VND').toUpperCase()
  if (code === 'VND') return `${formatMoney(value)} đ`
  return `${formatUnitPrice(value)} ${code}`
}

/**
 * ĐƠN GIÁ kèm mã tiền, nhưng CHỈ khi khác VND (bao-CR-439).
 *
 * Khác `formatMoneyWithCurrency` ở hai điểm, cả hai đều cố ý: giữ số lẻ (đơn giá
 * ngoại tệ thường là 4,85 chứ không phải số tròn) và KHÔNG gắn "đ" cho đồng nội tệ
 * — cột đơn giá trên bảng vốn không có đuôi, gắn vào thì cả cột dài thêm chỉ để
 * nhắc một điều ai cũng biết.
 *
 * Dùng ở những bảng gộp chung đơn nội tệ lẫn ngoại tệ: ở đó ô đơn giá là NGUYÊN TỆ
 * trong khi ô thành tiền ngay bên cạnh đã QUY ĐỔI về đồng, nên mã tiền là thứ duy
 * nhất nói cho người đọc biết vì sao nhân tay không ra.
 */
export function formatUnitPriceWithCurrency(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const price = formatUnitPrice(value)
  const code = (currency || '').trim().toUpperCase()
  if (!price || !code || code === 'VND') return price
  return `${price} ${code}`
}

/** Số lượng — tối đa 3 chữ số thập phân. */
export function formatQuantity(value: number | string | null | undefined): string {
  const num = toNumber(value)
  if (num === null) return ''
  return num.toLocaleString(locale, { maximumFractionDigits: 3 })
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}
