// Quy trình làm BÁO CÁO cho trợ lý (07/10/2026). Trước đó prompt chỉ có một dòng «lấy dữ liệu rồi soạn một bảng» nên
// mô hình hay đọc lướt một nhóm rồi xuất luôn, báo cáo thiếu số, không có nguồn. Phần này CHỈ gắn vào prompt khi câu
// hỏi là yêu cầu báo cáo (isReportRequest) — câu hỏi thường không tốn thêm token; lượt báo cáo đi mô hình NẶNG ngay từ
// đầu và được nhiều vòng gọi công cụ hơn để đọc đủ dữ liệu.

/** Lượt báo cáo được gọi công cụ tối đa ngần này vòng (thường: 6) — đọc nhiều nhóm / tệp trước khi xuất. */
export const REPORT_MAX_TOOL_ROUNDS = 10;

/** Bỏ dấu + chữ thường để khớp từ khóa tiếng Việt gõ không dấu / có dấu như nhau. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
}

const REPORT_PATTERN = new RegExp(
  [
    "\\bbao cao\\b", "\\btong hop\\b", "\\bthong ke\\b", "\\blap bang\\b", "\\bke bang\\b",
    "\\bxuat (ra )?(file|tep|excel|pdf|bang|sheet|bao cao)", "\\bexcel\\b", "\\bgoogle sheets?\\b", "\\bpdf\\b", "\\brecap\\b",
  ].join("|"),
);

/** Câu hỏi có phải yêu cầu báo cáo / tổng hợp / xuất file không. Hàm thuần. */
export function isReportRequest(question: string): boolean {
  return REPORT_PATTERN.test(fold(question));
}

export const REPORT_PLAYBOOK_PROMPT = `

ĐÂY LÀ YÊU CẦU BÁO CÁO — làm đúng QUY TRÌNH 4 BƯỚC, không đọc lướt rồi xuất ngay:
1. CHỐT PHẠM VI: khoảng thời gian, nhóm, người, chủ đề. Người hỏi không nói thì dùng mặc định hợp lý (7 ngày gần nhất; mọi nhóm
   đang đọc — hoặc nhóm đang hỏi nếu hỏi trong nhóm) và GHI RÕ phạm vi đã dùng ở đầu báo cáo. Chỉ hỏi lại khi không thể đoán
   (vd «báo cáo cho khách nào?» mà có nhiều khách).
2. LẤY ĐỦ DỮ LIỆU: đọc HẾT các nhóm / người / tệp / link trong phạm vi (gọi nhiều công cụ trong cùng một lượt được), không dừng ở
   nguồn đầu tiên. Dữ liệu bị cắt (truncated) thì thu hẹp khoảng thời gian và đọc tiếp từng đoạn.
3. TỰ KIỂM trước khi xuất: mọi con số lấy NGUYÊN VĂN từ dữ liệu (không ước, không làm tròn ngầm); tổng / tỷ lệ tự tính lại cho khớp;
   chỗ không có dữ liệu ghi «chưa có dữ liệu», không bịa; tên người / khách / nhóm viết đúng như trong tin.
4. VIẾT THEO KHUNG CHUẨN:
   - Tóm tắt đầu trang: 3–5 ý quan trọng nhất, ý nào cũng có số / tên cụ thể (không viết chung chung «tình hình ổn định»).
   - Chi tiết: mỗi dòng một mục (nhóm / việc / khách / nhân viên…), cột cuối «Nguồn» = nhóm · người gửi · dd/mm hh:mm của tin gốc.
   - Bất thường & rủi ro: việc trễ hạn, khiếu nại, số lệch, việc chưa có người phụ trách, câu hỏi chưa ai trả lời.
   - Việc cần làm: ai — việc — hạn (chỉ ghi khi dữ liệu có).
Người hỏi muốn FILE (Excel / Sheets / bảng) → export_report: notes = tóm tắt đầu trang, bảng chính = chi tiết (có cột Nguồn, dòng
«Tổng» khi có số cộng được), extra_sheets = «Bất thường» / «Việc cần làm» khi có. Muốn PDF → create_summary_pdf. Không nói định dạng
→ trả lời thẳng trong tin theo đúng khung trên (gọn: mỗi mục vài gạch đầu dòng).

VÍ DỤ trả lời đạt chuẩn (dữ liệu giả định):
Báo cáo nhóm «K52 – Công trường», 30/09–06/10/2026 (7 ngày):
Tóm tắt:
- 142 tin, 9 người trao đổi; tiến độ tầng 7 trễ 2 ngày so với mốc 05/10.
- 2 việc quá hạn: hợp đồng thép (Mai, hạn 03/10), báo giá cốp pha (Hùng, hạn 04/10).
- 1 khiếu nại tiếng ồn từ hộ dân bên cạnh (04/10), chưa có người nhận xử lý.
Bất thường:
- Đợt thanh toán 1 (800 triệu) chưa thấy xác nhận — Lan · 02/10 09:15.
Việc cần làm:
- Mai — gửi hợp đồng thép cho NCC — đã quá hạn 03/10.`;
