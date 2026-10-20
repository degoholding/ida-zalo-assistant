// Lời nhắc của công cụ AI `send_brief` (tệp LÁ: danh mục họ `send` lấy mà không kéo cầu nối MCP; brief-tool.ts re-export tên cũ).

/** Luật hướng dẫn thêm vào system prompt khi người hỏi có công cụ này (người hỏi là người nhận, tin riêng). */
export const BRIEF_TOOL_PROMPT = `

BẢN TIN, BÁO CÁO (người hỏi là người nhận bản tin): câu đã khớp sẵn bot tự trả lời, không tới lượt bạn. Câu hỏi
tương tự nhưng diễn đạt khác («cho anh bản tin của hôm nay», «anh muốn xem báo cáo tháng trước») → send_brief NGAY, rồi
báo ngắn gọn 1 câu là đang gửi — KHÔNG đọc lại nội dung bản tin (bạn không có nội dung đó).`;
