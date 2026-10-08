# 05 — Đối chiếu yêu cầu «Trợ lý Zalo AI cho IDA Global» với bot hiện tại (07/10/2026)

Nguồn: Google Sheet «Q&A làm rõ nhu cầu xây dựng IDA-Bot» (v0.2, 29/09/2026) — sheet CÂU HỎI (27 câu, đã có trả lời
của chủ sở hữu), Mẫu tin C10 (15 mẫu), NHU CẦU (N1–N7 + tiêu chí nghiệm thu), DANH MỤC VÍ DỤ (180 tính năng: 77 «Cần
thiết»), NKCV (nhật ký công việc mẫu, 1.680 dòng). Đối chiếu với nhánh `phase-b-cai-dat` @ 186cf3c, 07/10/2026.

## Kết luận

Bot hiện là **trợ lý hỏi–đáp** (người hỏi mới trả lời). Yêu cầu GĐ1 chủ yếu là **trợ lý chủ động cho MỘT chủ sở hữu**:
tự phân loại tin, cảnh báo khẩn ≤ 1 phút, nhắc tin chờ quá giờ, checklist việc, brief 07:30 / 17:30, gửi tin theo lệnh
có xác nhận. Phần «đọc – hiểu – tóm tắt – xuất file» đã có khá tốt; phần «chủ động – theo dõi – gửi» gần như chưa có.

| Nhu cầu | Mức đáp ứng | Đã có | Còn thiếu (GĐ1) |
|---|---|---|---|
| N1 Check tin nhắn | ~15% | Whitelist nhóm (bật «Đọc tin»), lưu tin, nhận @bot | /check, phân loại KHẨN/QUAN TRỌNG (từ khóa + AI), VIP list, nhận diện tin hỏi CHỦ SỞ HỮU, đồng hồ chờ (2 giờ / VIP 30 phút, giờ làm việc), đẩy báo khẩn ≤ 1 phút vào chat riêng, gộp 2 phút, tối đa 3 báo/ngày, giờ yên lặng |
| N2 Gợi ý trả lời | ~10% | Nhờ bot soạn bằng chat tự do | Thư viện 15 mẫu C10, 2–3 bản nháp khác tông, Chọn–Sửa–Bỏ qua, «[cần bổ sung]» thay số liệu, chỉ gửi khi xác nhận |
| N3 Thống kê số liệu | ~40% | Đọc tin theo khoảng thời gian, đọc Excel / ảnh / ghi âm, xuất Excel / Sheets / PDF theo yêu cầu | Trích số có cấu trúc lưu DB (đo ≥ 95%), cờ «cần xác nhận», dòng tổng / so kỳ trước / lệch ±30%, NV chưa báo cáo sau 18:00, danh mục NV + đại lý, file KPI |
| N4 Tìm kiếm | ~40% | Tìm tệp theo tên + nội dung đã bóc, xem tin theo nhóm / thời gian, màn Hội thoại web | Công cụ tìm TIN NHẮN theo từ khóa + người + nhóm + ngày, trích dẫn nguồn + «xem tin trước / sau», ≤ 5 giây / 6 tháng dữ liệu, voice → chữ tự động, thời hạn lưu 24 tháng (tệp gốc 6 tháng) |
| N5 Checklist | ~10% | Nhắc hẹn Zalo trong nhóm (lặp), bảng việc trong PDF recap họp | Bảng checklist (DB + màn web), bot đề xuất việc từ tin → chủ sở hữu xác nhận, /xong /doihan, nhắc trước 1 ngày / đúng hạn / quá hạn, cờ thiếu người / hạn |
| N6 Tóm tắt & báo cáo | ~40% | Tóm tắt nhóm / người theo yêu cầu, báo cáo theo yêu cầu ra Excel / Sheets / PDF mẫu DEGO | Morning Brief 07:30 + End-of-day 17:30 tự gửi, báo cáo tuần (08:00 thứ 2) / tháng (ngày 3), 1 trang A4 + Excel kèm, tên tệp «Tên công việc - Thời gian - Tên nhân viên», mọi ý truy ngược về tin gốc |
| N7 Gửi tin theo lệnh | ~10% (cố ý chặn) | Nhắc hẹn / ghim / bình chọn trong nhóm đang hỏi; quản trị gửi tin / tệp từ web | /gui, /hengio, xem trước → xác nhận → gửi → báo kết quả, /huy, /tatbot, nhật ký gửi |
| L0 Nền tảng | ~50% | Whitelist, lưu DB, audit log thao tác quản trị, nhật ký từng lượt hỏi, phân quyền vai trò + nhân sự / khách hàng, tắt trả lời nhóm | Khái niệm «chủ sở hữu» + kênh lệnh riêng (hiện mọi Quản lý / Trưởng phòng / nhân sự đều gọi được), nhóm «Mật» (không gửi AI), che dữ liệu nhạy cảm trước khi gửi AI, /tatbot, giám sát kết nối Zalo + báo kênh dự phòng |

Có sẵn NGOÀI yêu cầu: recap họp từ ghi âm ra PDF, tạo / hủy Google Meet, đọc link Google Sheets / Docs, tìm web,
chọn Gemini / OpenAI.

## Hạ tầng còn thiếu (làm trước, các tính năng dựa lên)

1. **Chủ sở hữu + kênh lệnh riêng**: khai 1 chủ sở hữu (sau mở rộng), chat riêng chủ sở hữu ↔ nick bot là nơi nhận báo
   và ra lệnh (/check, /xong, /gui…). Người khác ra lệnh bị từ chối.
2. **Bộ lập lịch**: chạy việc theo giờ (brief, báo cáo tuần / tháng, nhắc hạn, đồng hồ chờ), tôn trọng giờ làm việc /
   giờ yên lặng / ngày lễ.
3. **Phân loại tin lúc nhận**: từ khóa KHẨN / QUAN TRỌNG, VIP, tin hỏi chủ sở hữu, AI nhận khẩn không từ khóa (5–10 phút);
   lưu mức ưu tiên + trạng thái (chưa trả lời / đã xem / đã xử lý).
4. **Bảng việc (checklist)**: việc, người, hạn, trạng thái, tin nguồn; màn web.
5. **Luồng gửi có xác nhận**: xem trước → xác nhận → gửi qua hàng gửi chung → nhật ký → /huy.
6. **Tìm tin nhắn**: chỉ mục toàn văn (MySQL FULLTEXT) + công cụ cho bot + màn web.

## Đề xuất thứ tự (GĐ1)

1. Chủ sở hữu + kênh lệnh + /check + phân loại + báo khẩn (N1) — giá trị lớn nhất, đo được ngay.
2. Bộ lập lịch + Morning / End-of-day Brief (N6).
3. Checklist + nhắc hạn (N5).
4. Tìm tin nhắn (N4) + nhóm «Mật» + che dữ liệu nhạy cảm (L0).
5. Gợi ý trả lời theo mẫu C10 (N2) + gửi theo lệnh có xác nhận (N7).
6. Trích số liệu sales có cấu trúc (N3) — cần bộ 30–50 tin báo cáo thật + số đúng để đo ≥ 95%.

## Điểm cần chốt với chủ sở hữu

> **08/10/2026 — đã chốt:** câu 1 làm cho **3 người nhận cùng lúc** (không phải 1 chủ sở hữu); bot được trả lời
> trong nhóm khi có người gọi; bot chạy VPS riêng; phục vụ IDA trước, sau tách theo công ty. Phase đổi sang đánh số 1–10. Lộ trình và trạng
> thái từng việc chuyển sang [`06-lo-trinh.md`](06-lo-trinh.md) — thứ tự ở mục «Đề xuất thứ tự» trên đây hết hiệu lực.

- Câu 1 trả lời «Trưởng phòng, CEO, trưởng nhóm — theo thứ tự ưu tiên»: GĐ1 làm cho 1 người (đề xuất của file) hay
  nhiều người ngay? Ảnh hưởng thiết kế kênh lệnh, VIP list, brief.
- Câu 2: mở rộng ~100 nhóm — ảnh hưởng chi phí AI (phân loại AI mọi tin) và cấu hình máy chủ.
- Câu 3: vào cả nhóm KHÔNG có quyền trưởng / phó nhóm — nick bot phải được ai đó thêm vào.
- Câu 9: tối đa 3 báo / ngày (khác đề xuất 10). Câu 7: giờ làm việc 08:30–12:00, 13:30–17:30.
- N2 «Ai là người sử dụng tính năng này?» — DX còn ghi chú mở.
- N4: chi phí / khối lượng lưu trữ, tần suất dùng — DX còn ghi chú mở.
