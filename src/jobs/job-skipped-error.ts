/**
 * Handler việc nền ném lỗi này = BỎ việc (đánh Expired), KHÔNG thử lại — dùng khi việc không còn nên chạy (bot đang
 * tắt khẩn, lệnh đã hủy…) chứ không phải lỗi tạm thời. `message` là lý do ghi vào nhật ký / báo người dùng.
 */
export class JobSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobSkippedError";
  }
}
