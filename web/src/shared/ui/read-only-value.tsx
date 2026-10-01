import { cn } from '@/shared/utils/cn'

interface ReadOnlyValueProps {
  children?: React.ReactNode
  /**
   * Chữ dài (tên hàng, ghi chú, mô tả): xuống dòng thay vì cắt cụt, và cao tối
   * thiểu bằng `Textarea` để bố cục không nhảy khi bật/tắt chế độ sửa.
   */
  multiline?: boolean
  className?: string
}

/**
 * Ô CHỈ ĐỌC — dùng thay cho `<Input disabled>` / `<Textarea disabled>` ở mọi chỗ
 * chỉ hiện dữ liệu chứ không cho sửa.
 *
 * `disabled` là thuộc tính của Ô NHẬP LIỆU, nói rằng "ô này không tham gia biểu
 * mẫu". Trình duyệt hiểu theo nghĩa đen: ô mất khả năng nhận con trỏ nên KHÔNG
 * bôi đen và KHÔNG copy được — người dùng không chép nổi mã vật tư ra ngoài —
 * lại còn bị làm mờ 50% nên giá trị thật nhìn y như chữ gợi ý (placeholder).
 * Chữ nằm trong thẻ thường thì bôi đen / copy / đọc màn hình đều bình thường.
 *
 * `readOnly` cũng giữ được việc bôi đen, nhưng ô vẫn trông như đang mời gõ vào.
 * Ở đây phần lớn màn là XEM chứng từ, nên hiện thẳng dạng chữ đúng hơn.
 *
 * FORMAT KHÓA THÔNG TIN (chốt 09/09/2026): nền rất nhạt `--locked` (#f8fafc), chữ
 * NAVY đậm `--locked-foreground` (#1b2559) + `font-semibold` (600) + con trỏ
 * `not-allowed` + mờ nhẹ `opacity-90`. Điểm phân biệt với ô nhập trắng nay là CHỮ
 * (đậm, navy) và con trỏ chứ không phải nền — nên nền để rất nhạt vẫn nhận ra ngay.
 */
export function ReadOnlyValue({ children, multiline = false, className }: ReadOnlyValueProps) {
  const isDash = typeof children === 'string' && (children === '—' || children === '-')
  const empty = children === null || children === undefined || children === '' || isDash

  return (
    <div
      className={cn(
        //  `min-w-0` + `break-words`: chuỗi dài KHÔNG khoảng trắng (email, URL, mã) phải
        //  xuống dòng trong ô thay vì đẩy tràn cả lưới ra ngoài màn hình (lỗi responsive).
        //  Format khóa: nền `bg-locked` + viền `input` + chữ `locked-foreground` đậm 600,
        //  con trỏ `not-allowed`, mờ nhẹ `opacity-90`.
        'min-w-0 cursor-not-allowed break-words rounded-lg border border-input bg-locked px-3 text-sm font-semibold text-locked-foreground opacity-90',
        multiline
          ? 'min-h-16 py-2.5 whitespace-pre-wrap'
          : 'flex min-h-9 items-center py-2',
        className,
      )}
    >
      {empty ? null : children}
    </div>
  )
}
