import type { LinesTableColumn, LinesTableControl } from './types'

/**
 * SÀN BỀ RỘNG CỘT của `LinesTable` (bao-CR-359).
 *
 * Bảng dòng chạy `table-fixed`, nên bề rộng cột là do người khai bảng quyết chứ
 * không phải do nội dung. Khai hụt vài pixel thì KHÔNG có gì đỏ lên: ô nhập bên
 * trong tự cắt bớt chữ của chính nó và người dùng đọc ra một giá trị sai —
 * "20/09/…" trông hệt nhau ở ngày 20/09/2026 và 20/09/2027.
 *
 * Chỗ này quy đổi "cột chứa loại ô nào" thành một con số đo được, để cái sàn đó
 * nằm ở MỘT nơi thay vì rải rác trong bảy tệp khai cột.
 */

/** Chặn dưới mặc định khi kéo giãn cột — cột không khai `minWidth` thì lấy số này. */
export const LINE_COLUMN_MIN_WIDTH = 40

/**
 * Sàn cho cột chứa ô **chọn ngày** (`DatePicker size="sm"`).
 *
 * Đo trên trình duyệt thật, không phải ước lượng: nút bấm của `DatePicker` cỡ nhỏ
 * cần **135,3px** (biểu tượng lịch `size-4` + `gap-2` + `px-2` + chuỗi
 * `20/09/2026` ở `text-sm` = 71,3px + dấu X xóa ngày `size-3.5`), cộng `px-2.5`
 * hai bên của ô bảng = 20px, ra **155,3px**. Làm tròn lên 156.
 *
 * ⚠️ Con số này gắn với CHROME của `DatePicker`. Đổi `gap` / `px` / cỡ biểu tượng
 * trong `shared/ui/date-picker.tsx` thì phải đo lại đây, không thì cột rộng thừa
 * (hoặc tệ hơn: hụt lại như cũ mà không ai biết).
 */
export const DATE_CONTROL_MIN_WIDTH = 156

const CONTROL_MIN_WIDTH: Record<LinesTableControl, number> = {
  date: DATE_CONTROL_MIN_WIDTH,
}

/** Phần khai báo mà hai hàm dưới đây cần — nhận cả cột gốc lẫn cột đã chuẩn hóa. */
type WidthSpec = Pick<LinesTableColumn, 'control' | 'width' | 'minWidth'>

/**
 * Chặn dưới THẬT của một cột: lớn hơn giữa `minWidth` người khai và sàn của loại ô.
 *
 * Trả về sàn của loại ô chứ không phải `minWidth` khai hụt, vì `minWidth` còn là
 * mức mà tay kéo giãn cột dừng lại — để nguyên thì người dùng kéo hẹp lại được và
 * lỗi cắt chữ quay về ngay sau khi vừa vá xong.
 */
export function lineColumnMinWidth(column: WidthSpec): number {
  const declared = column.minWidth ?? LINE_COLUMN_MIN_WIDTH
  const floor = column.control ? CONTROL_MIN_WIDTH[column.control] : 0
  return Math.max(declared, floor)
}

/**
 * Bề rộng dùng để vẽ cột: bề rộng đã lưu (người dùng kéo) hoặc bề rộng khai,
 * nhưng **không bao giờ thấp hơn chặn dưới**.
 *
 * Kẹp cả bề rộng ĐÃ LƯU là chủ ý. `useTableLayout` chỉ ghi vào `columnWidths`
 * những cột người dùng tự kéo, nên sửa `width` trong mã nguồn tới được gần hết
 * mọi người — trừ đúng người đã từng kéo cột đó, tức là người quan tâm tới nó
 * nhất. Kẹp ở đây thì bản lưu cũ 110px cũng tự nâng lên sàn mới.
 *
 * Cột không khai `width` thì để `undefined` (co giãn theo phần còn lại của bảng),
 * trừ khi nó có sàn bắt buộc — lúc đó trả về đúng sàn.
 */
export function lineColumnWidth(column: WidthSpec, savedWidth?: number): number | undefined {
  const min = lineColumnMinWidth(column)
  const width = savedWidth ?? column.width
  if (width === undefined) return column.control ? min : undefined
  return Math.max(width, min)
}
