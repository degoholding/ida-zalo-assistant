import { cn } from '@/shared/utils/cn'

/**
 * Lời nhắc mặc định. Chứng từ mua hàng chặn ở bước GỬI DUYỆT chứ không chặn lúc
 * Lưu — người lập vẫn cất phiếu nháp thiếu ô được, nên đừng viết "bắt buộc nhập"
 * trống không kẻo họ tưởng không lưu nổi.
 */
export const REQUIRED_HINT = 'Bắt buộc trước khi gửi duyệt'

interface RequiredMarkProps {
  /** Đổi lời nhắc khi ô có luật riêng (ví dụ "chọn một trong hai ô"). */
  hint?: string
  className?: string
}

/**
 * Dấu sao đỏ của ô bắt buộc.
 *
 * Đặt SÁT nhãn bằng `ml-0.5` thay vì chèn dấu cách vào chuỗi nhãn: nhãn nằm
 * trong chuỗi thì bản in, ô tìm kiếm và trình đọc màn hình đều nuốt luôn dấu sao
 * thành một phần của tên trường.
 */
export function RequiredMark({ hint = REQUIRED_HINT, className }: RequiredMarkProps) {
  return (
    <span className={cn('ml-0.5 text-destructive', className)} title={hint}>
      *
    </span>
  )
}
