import { toast } from 'sonner'

/**
 * Toast ĐỎ báo vừa xóa một bản ghi, kèm nút **Hoàn tác** màu XANH LÁ.
 *
 * Dùng chung cho các thao tác xóa "có thể lấy lại": nút hoàn tác phải nổi bật và
 * mang màu tích cực (xanh lá `--success`) để tách khỏi nền đỏ của thông báo xóa —
 * người dùng nhận ra ngay đây là đường lùi an toàn, không phải một cảnh báo nữa.
 */
export function toastDeletedWithUndo(
  message: string,
  onUndo: () => void,
  duration = 8000,
): void {
  toast.error(message, {
    action: { label: 'Hoàn tác', onClick: onUndo },
    //  Nút hành động của sonner nằm ngoài cây Tailwind của trang → tô màu bằng
    //  inline style qua token `--success`; chữ trắng cho tương phản trên nền xanh.
    actionButtonStyle: { backgroundColor: 'var(--success)', color: '#fff' },
    duration,
  })
}
