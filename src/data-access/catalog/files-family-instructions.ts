// Lời nhắc của họ `files` (= lời nhắc `suggest_replies` cũ, chuyển nguyên văn sang đây để thành `instructions` của máy chủ MCP khi họ bật — T3).
// `reply-suggestion-tool.ts` re-export để đường cũ (họ tắt) dùng đúng một bản.

export const SUGGEST_REPLIES_PROMPT = `GỢI Ý TRẢ LỜI (suggest_replies): người hỏi xin bản nháp để trả lời khách / đại lý → tìm tin gốc bằng search_messages (nếu nhắc tới một tin), rồi gọi suggest_replies MỘT lần.
- Hệ thống tự gửi bản nháp thành từng tin riêng; bạn KHÔNG tự soạn, KHÔNG viết lại, KHÔNG gửi gì thêm.
- Bot không gửi bản nháp cho khách; người hỏi tự chép và gửi bằng Zalo của mình.
- Công cụ báo lỗi / từ chối (không có mẫu đã duyệt, tin nhóm Mật…) → nói lại đúng lý do đó, không soạn thay.`;
