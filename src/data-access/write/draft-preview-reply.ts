// Câu bot gửi khi vừa tạo nháp ghi: bản xem trước nguyên văn + mã + cách xác nhận. Máy chủ dựng (mô hình KHÔNG nhận mã).

export function formatDraftPreviewReply(preview: string, code: string): string {
  return [
    `Em sẽ ghi: ${preview}`,
    `Mã xác nhận: ${code} (hiệu lực 10 phút).`,
    "Anh/chị nhắn «đồng ý» để lưu, «hủy» để bỏ. Nếu đang có nhiều nháp chờ thì nhắn «đồng ý " + code + "» hoặc «hủy " + code + "».",
  ].join("\n");
}
