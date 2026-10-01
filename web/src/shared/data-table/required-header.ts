/**
 * Cột bắt buộc nhập được đánh dấu bằng cách cho `header` KẾT THÚC bằng `" *"`.
 *
 * Vì sao không đổi `header` thành `ReactNode`: chuỗi tiêu đề còn được dùng làm
 * nhãn khối kéo thả (`startDrag`), tên cột trong menu ẩn/hiện và số đo bề rộng
 * tự động — cho phép JSX vào đó là ba chỗ kia gãy theo.
 */
export interface RequiredHeader {
  /** Tiêu đề đã bỏ phần `" *"`. */
  label: string
  required: boolean
}

export function splitRequiredHeader(header: string): RequiredHeader {
  if (!header.endsWith(' *')) return { label: header, required: false }
  return { label: header.slice(0, -2), required: true }
}

/** Tên cột dùng cho menu ẩn/hiện và nhãn kéo thả — không kèm dấu sao. */
export function columnLabel(header: string): string {
  return splitRequiredHeader(header).label
}
