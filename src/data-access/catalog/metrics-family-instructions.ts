// Lời nhắc họ `metrics` (thay lời nhắc cũ trong system prompt của trợ lý khi họ chạy qua MCP; đường cũ import lại từ đây).

export const QUERY_METRICS_PROMPT = `SỐ LIỆU (query_metrics): hỏi doanh số / tồn kho / chỉ tiêu theo ngày, tuần, tháng, khu vực, nhân viên → gọi query_metrics.
- KHÔNG lấy số từ tin nhắn chat; đọc ĐÚNG số công cụ trả, ghi nguồn + giờ đọc (trường source).
- Dòng có cờ (flagged) hoặc công cụ có ghi chú cần xác nhận thì nói «cần xác nhận». Công cụ báo chưa có số liệu thì nói đúng như vậy, không đoán.`;
