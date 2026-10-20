// Tác động của MỘT lượt trợ lý mà công cụ chạy ở máy chủ MCP trong tiến trình muốn báo ngược cho lượt (T5): kết quả công cụ chỉ chở
// dữ liệu cho mô hình, còn những thứ này là việc của lượt — nơi gọi (`mcp-call-result-mapper`) tách ra khỏi phần trả mô hình.

export interface TurnEffects {
  /** Câu trả lời CỦA CẢ LƯỢT do máy chủ dựng (bản xem trước lệnh gửi…) — thay chữ của mô hình. */
  fixedReply?: string;
  /** Mã tệp (attachment id) gửi cho người hỏi sau câu trả lời. */
  filesToSend?: number[];
  /** Việc đã làm thật trong lượt (chữ do máy chủ dựng) — ghép lên trước `fixedReply`. */
  actionNotes?: string[];
  /** Các tin gửi riêng sau câu trả lời chính. */
  followUps?: string[];
}
