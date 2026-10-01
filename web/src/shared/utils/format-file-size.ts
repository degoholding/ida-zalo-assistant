/**
 * Dung lượng tệp đính kèm, đọc bằng mắt chứ không cần tính.
 *
 * Dưới 1 MB thì hiện KB và KHÔNG bao giờ ra "0 KB" cho tệp có nội dung: ảnh chữ
 * ký hay tệp XML vài trăm byte vẫn là tệp thật, hiện 0 là người dùng tưởng tải
 * hỏng rồi tải lại. Chỉ tệp rỗng thật (0 byte) mới ra "0 KB".
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
