# Đối chiếu đặc tả IDA («CÁC NHU CẦU.xlsx») với Bot trợ lý hiện có

> Bản 1.1 · 02/10/2026: câu 1 mục 4 đã chốt (câu tự nhiên, bỏ lệnh gạch chéo); thêm phase B (Cài đặt +
> Google Sheets) trước đợt 0; mục 5 cập nhật đường lấy tin cũ. Lộ trình gộp và trạng thái từng phase:
> [`03-mo-ta-chuc-nang.md`](03-mo-ta-chuc-nang.md) mục 7.
>
> Bản 1.0 · 01/10/2026 · nguồn: tệp `CÁC NHU CẦU.xlsx` IDA gửi qua Zalo (sheet NHU CẦU: 7 nhu cầu N1–N7
> kèm tiêu chí nghiệm thu; sheet DANH MỤC VÍ DỤ: 180 tính năng chia 5 cấp vai trò L1–L5 + nền tảng L0,
> gắn ưu tiên P1/P2/P3 = giai đoạn GĐ1/GĐ2/GĐ3). Đối chiếu với mã trên nhánh `dev1` tới commit `fc197ca`.
>
> Cách đọc: **Có** = chạy được, đúng tinh thần đặc tả · **Một phần** = có nền, thiếu một vế quan trọng ·
> **Chưa** = chưa làm. Cỡ việc: S (≤ 1 ngày), M (2–4 ngày), L (≥ 1 tuần).

## 0. Kết luận nhanh

- Bản hiện tại là **nền hạ tầng + hỏi đáp theo yêu cầu**: đọc nhóm, lưu tin / tệp / thành viên, Danh bạ,
  hỏi bot bằng câu tự nhiên (tóm tắt nhóm, trao đổi với một người, tìm tệp, đọc tệp, tìm web), giao diện
  quản trị, nhật ký. Phần này khớp L0 và một phần L2.
- Đặc tả IDA đặt trọng tâm vào thứ bot **tự làm, tự báo**: gom tin cần xử lý (/check), phát hiện câu
  hỏi chưa trả lời, checklist việc + nhắc hạn, bản tin sáng / tối, gửi tin theo lệnh có xem trước. Những
  thứ này **đều cần một bộ lập lịch + một «bảng cờ» gắn lên tin nhắn** mà bot chưa có.
- Giai đoạn 1 có **44 tính năng P1**: **6 Có · 14 Một phần · 24 Chưa**. Nhu cầu N4 (tìm kiếm) gần xong nhất;
  N1 (check tin nhắn) và N5 (checklist) là hai cụm lớn nhất còn trống; N7 (gửi theo lệnh) đã có đường gửi,
  thiếu luồng xem trước – xác nhận – hẹn giờ.
- Hai khác biệt về **mô hình vận hành** (mục 4): đặc tả viết cho MỘT chủ sở hữu ra lệnh bằng **lệnh gạch
  chéo** (/check, /gui…); bot cho **nhiều người** (quản lý + trưởng phòng) hỏi bằng **câu tự nhiên**. Đã chốt
  02/10: **không làm lệnh gạch chéo** — bot tự hiểu ý trong câu; tên lệnh trong bảng dưới chỉ để đối chiếu.
  Câu chủ sở hữu còn mở.

## 1. Bảy nhu cầu cốt lõi (sheet NHU CẦU)

| Mã | Nhu cầu | Trạng thái | Đã có | Còn thiếu so với tiêu chí nghiệm thu |
|---|---|---|---|---|
| N1 | Check tin nhắn | **Chưa** | Lưu đủ tin, kể cả `mentions`; whitelist nhóm (bật đọc từng nhóm); Danh bạ có thẻ (dùng làm VIP được) | Lệnh /check; nhận diện @mention / hỏi thẳng chủ (≥ 90 %); phân loại Khẩn / Quan trọng / Thường; VIP báo ≤ 1 phút; nhắc tin chưa trả lời quá X giờ; trạng thái đã / chưa trả lời |
| N2 | Gợi ý trả lời | **Chưa** | Bot soạn được văn bản; đường gửi dưới tên bot đã có | 2–3 bản nháp khác tông; nút Chọn – Sửa – Bỏ qua; thư viện mẫu; số liệu có nguồn; **không gửi khi chưa xác nhận** |
| N3 | Thống kê số liệu | **Chưa** | Đọc được ảnh / xlsx / pdf thành chữ (`read_file`) | Trích số từ tin báo cáo thành bảng; gắn «cần xác nhận» khi mơ hồ; dòng tổng, đánh dấu bất thường; xuất Excel |
| N4 | Tìm kiếm tin nhắn | **Một phần** | Tìm tệp theo tên + **nội dung** đã bóc (pdf / Excel); AI tìm theo người, nhóm, khoảng ngày; chữ bóc có FULLTEXT | Tìm **tin nhắn** theo từ khóa trên web (hiện chỉ có tìm cuộc); lệnh tìm đa điều kiện (từ khóa + người + nhóm + ngày + loại tin); kết quả kèm đường dẫn về tin gốc; voice → chữ; mốc ≤ 5 giây / 6 tháng chưa đo |
| N5 | Checklist công việc | **Chưa** | — | Bảng việc; bot đề xuất việc từ tin, chủ xác nhận; /xong /doihan /giao; nhắc trước hạn – đến hạn – quá hạn; gắn cờ thiếu owner / deadline |
| N6 | Tổng hợp báo cáo | **Một phần** | Tóm tắt nhóm theo khoảng thời gian, theo người, theo yêu cầu (câu tự nhiên); đã chuyển bản flash cho tóm tắt dài | Morning / End-of-day Brief gửi đúng giờ; báo cáo theo mẫu, theo khách hàng / nhân viên; mọi ý truy ngược về tin gốc; xuất Excel / Word / PDF; tên tệp theo quy ước |
| N7 | Gửi tin theo lệnh | **Một phần** | Gửi chữ + tệp vào người / nhóm dưới tên bot (từ web); giãn cách gửi 1,5 s; tin gửi có ghi kho và nhãn «quản trị» | Ra lệnh từ Zalo (/gui, /hengio, /guihangloat); **xem trước → xác nhận → gửi → báo kết quả**; hẹn giờ; gửi hàng loạt có báo thành công / lỗi; /huy và /tatbot; nhật ký gửi có trạng thái |

## 2. Giai đoạn 1 — 44 tính năng P1 (sheet DANH MỤC VÍ DỤ)

### 2.1 Đã có (6)

| Mã | Tính năng | Ghi chú |
|---|---|---|
| TN004 | Tóm tắt nhóm | theo giờ / ngày / tuần / người / khách — qua câu tự nhiên, chưa có lệnh /tomtat |
| B15 | Tìm file / ảnh đã gửi | `search_files` + màn Tệp; tìm cả trong nội dung đã bóc |
| TN137 | Data Logging | tin, tệp, thành viên, lượt hỏi (`assistant_turn`), nhật ký thao tác (`audit_log`) |
| B12 | Duyệt trước khi gửi | bot KHÔNG tự trả lời trong nhóm; chỉ trả lời người có vai trò trong cuộc riêng |
| B34 | Kênh ra lệnh riêng | cuộc riêng 1-1; người lạ bị bỏ qua (lưu, không trả lời) |
| B35 | Whitelist hội thoại | `read_messages` từng nhóm, mặc định TẮT; nhóm chưa bật không lưu một chữ |

### 2.2 Một phần (14)

| Mã | Tính năng | Đã có | Thiếu | Cỡ |
|---|---|---|---|---|
| TN001 | Đọc & hiểu hội thoại | đọc, lưu, phân loại loại tin (chữ / ảnh / tệp…) | gắn nhãn nghiệp vụ: câu hỏi / giao việc / phản ánh / thường | M |
| TN005 | Executive Summary | prompt đã dặn «việc chính, ai làm gì, vấn đề, việc treo» | mẫu cố định Việc gì → Vì sao → Tác động → Phụ trách → Deadline → Tiếp theo | S |
| TN138 | Search History | AI lấy tin theo nhóm / người / khoảng ngày | công cụ tìm tin theo **từ khóa** (`search_messages`) + đoạn trích + link tin gốc | S |
| B13 | Tìm kiếm đa điều kiện | tệp: có; tin: lọc theo người / nhóm / ngày qua AI | từ khóa + loại tin; màn tìm tin trên web | M |
| B16 | Trích dẫn nguồn | kết quả tìm tệp có nhóm, người, ngày | link mở tin gốc (web có route `/conversations/:id`, cần thêm neo tới tin) | S |
| B26 | Báo cáo theo yêu cầu | tóm tắt on-demand bằng câu tự nhiên | dạng «báo cáo» có tóm tắt đầu + bảng chi tiết, xuất tệp | M |
| B27 | Gửi tin tới 1 người / nhóm | gửi được từ web (chữ + tệp) | ra lệnh từ Zalo; xem trước → xác nhận | M |
| B17 | Thống kê hoạt động | số tin / nhóm, số tin riêng / người (web) | theo ngày, theo người; thời gian phản hồi TB; tin chưa xử lý; lệnh /thongke | M |
| TN091 | Audit Trail | nhật ký thao tác web, lượt hỏi bot, tin bot gửi (nguồn AI / quản trị) | log lệnh gửi từ Zalo (chưa có lệnh), evidence | S |
| TN135 | Permission Control | chỉ người có vai trò được hỏi; quyền hiện MỞ HẾT (mọi vai trò hỏi mọi nhóm) | khoanh trưởng phòng theo nhóm họ ở (đã thiết kế ở doc 01, chưa làm); từ chối câu hỏi ngoài quyền | M |
| TN136 | Confidentiality | whitelist nhóm | nhãn «Mật» cho nhóm → loại khỏi báo cáo gửi người khác | S |
| B33 | Nhật ký gửi & trạng thái | tin gửi được lưu | trạng thái đã gửi / lỗi, gửi lại; lệnh /nhatky | S |
| B38 | Kill switch | tắt tài khoản bot trên web (dừng ngay) | lệnh /tatbot từ Zalo, dừng cả lịch hẹn | S |
| B40 | Giám sát kết nối Zalo | trạng thái «Hết phiên — cần quét QR» hiện trên web; sự kiện phiên có lưu | **chủ động báo** chủ + IT khi phiên văng (cần kênh dự phòng — Telegram theo doc 01 chưa làm) | S |

### 2.3 Chưa làm (24)

| Mã | Tính năng | Thuộc cụm | Cỡ |
|---|---|---|---|
| B01 | Hộp thư hợp nhất /check | Check tin nhắn | M |
| B02 | Phân loại Khẩn / Quan trọng / Thường | Check tin nhắn | M |
| B03 | VIP list | Check tin nhắn (dùng thẻ Danh bạ) | S |
| B04 | Nhận diện @mention / hỏi thẳng chủ | Check tin nhắn (`mentions` đã lưu) | S |
| B05 | Cảnh báo chưa phản hồi quá X giờ | Check tin nhắn + lập lịch | M |
| B06 | Thông báo đẩy tin khẩn | Check tin nhắn + lập lịch | S |
| TN097 | Phát hiện câu hỏi chưa trả lời | Check tin nhắn | M |
| TN006 | Trích xuất Action Item | Checklist | M |
| TN007 | Task Management | Checklist | M |
| TN008 | Deadline Management | Checklist + lập lịch | S |
| B21 | Checklist việc của tôi /viec | Checklist | S |
| B22 | Cập nhật checklist bằng lệnh | Checklist | S |
| TN017 | Morning Brief | Báo cáo + lập lịch | M |
| TN018 | End-of-day Brief | Báo cáo + lập lịch | S (sau Morning) |
| B24 | Báo cáo theo mẫu định sẵn | Báo cáo | M |
| B20 | Xuất Excel / Google Sheets | Báo cáo / Thống kê (SheetJS đã có sẵn trong kho) | S |
| B18 | Trích số liệu từ tin báo cáo sales | Thống kê | M |
| B19 | Hỏi rõ đơn vị khi số liệu mơ hồ | Thống kê | S |
| B28 | Hẹn giờ gửi | Gửi theo lệnh + lập lịch | S |
| B32 | Xem trước, xác nhận & hủy | Gửi theo lệnh | M |
| B08 | Gợi ý 2–3 phương án trả lời | Gợi ý trả lời | M |
| B09 | Thư viện mẫu trả lời nhanh | Gợi ý trả lời | S |
| B36 | Che dữ liệu nhạy cảm trước khi gửi AI | Nền tảng | S |
| B37 | Tuân thủ bảo vệ dữ liệu cá nhân | Nền tảng (quyết định + tài liệu, không phải mã) | S |

## 3. Thứ tự làm đề nghị cho GĐ1

Nguyên tắc: làm **hạ tầng chung** trước (một lần, dùng cho 4 cụm), rồi đi theo nhu cầu IDA đặt tên
đầu tiên (N1), mỗi cụm xong là nghiệm thu được một nhu cầu.

| Đợt | Việc | Phục vụ | Cỡ |
|---|---|---|---|
| B | **Cài đặt + Google Sheets** (chen trước, chốt 02/10): bảng `app_setting` + màn Cài đặt sửa cấu hình trên web không build lại, khóa bí mật mã hóa; ghi Google Sheets bằng service account — **xong 03/10/2026** (client + nút kiểm tra; xuất báo cáo thật để phase G) | B20, G (bản tin), mọi ngưỡng cấu hình | S |
| 0 | **Hạ tầng**: bộ lập lịch (beat) trong tiến trình; bảng «cờ» trên tin (`message_flag`: loại, ưu tiên, đã xử lý, ai xử lý); khái niệm **chủ sở hữu** của mỗi tài khoản bot (người nhận bản tin / cảnh báo); che SĐT / STK / CCCD trước khi gửi AI (B36) | mọi cụm | M |
| 1 | **Check tin nhắn (N1)**: gắn cờ @mention / hỏi thẳng chủ (B04), VIP từ thẻ Danh bạ (B03), từ khóa ưu tiên + AI phân loại (B02, TN001), câu hỏi chưa trả lời quá X giờ (TN097, B05), lệnh /check hoặc câu «có gì cần xử lý» (B01), đẩy tin khẩn (B06) | N1 | L |
| 2 | **Tìm kiếm (N4)**: công cụ `search_messages` (từ khóa + người + nhóm + ngày + loại), màn tìm tin trên web, link về tin gốc, đoạn trích (TN138, B13, B16) | N4 | M |
| 3 | **Checklist (N5)**: bảng việc; bot đề xuất từ tin → chủ xác nhận (TN006); /viec /xong /doihan /giao (B21, B22, TN007); nhắc 3 mốc (TN008) | N5 | L |
| 4 | **Bản tin & báo cáo (N6)**: Morning / EOD Brief theo giờ cấu hình (TN017, TN018); mẫu Executive Summary (TN005); xuất Excel bằng SheetJS (B20); báo cáo theo mẫu (B24, B26) | N6 | L |
| 5 | **Gửi theo lệnh (N7)**: lệnh từ Zalo → xem trước → xác nhận → gửi → báo kết quả (B27, B32); hẹn giờ + /huy (B28); /tatbot (B38); nhật ký gửi có trạng thái (B33) | N7 | M |
| 6 | **Thống kê (N3)**: trích số từ tin báo cáo (B18), hỏi rõ đơn vị (B19), bảng + xuất Excel (B20), thống kê hoạt động (B17) | N3 | M |
| 7 | **Gợi ý trả lời (N2)**: thư viện mẫu (B09), 2–3 bản nháp theo tông (B08) — gửi qua luồng xác nhận của đợt 5 | N2 | M |
| 8 | **Nền tảng còn lại**: khoanh quyền trưởng phòng theo nhóm (TN135), nhãn Mật (TN136), cảnh báo phiên văng qua kênh dự phòng (B40), tài liệu PDPL (B37) | L0 | M |

Tổng cỡ GĐ1: khoảng **4 L + 5 M** việc, tức vài tuần làm liên tục nếu không có yêu cầu chen ngang.

## 4. Điều phải chốt trước khi làm đợt 0–1

1. ~~Lệnh gạch chéo hay câu tự nhiên?~~ **Đã chốt 02/10/2026: chỉ câu tự nhiên**, bỏ mọi lệnh /check, /gui…
   — bot tự phân tích ý trong tin nhắn. Nghiệm thu theo đặc tả IDA thì dùng câu tương đương.
2. **Chủ sở hữu là ai?** Đặc tả có MỘT chủ (chị Mi) nhận mọi bản tin / cảnh báo và là người duy nhất ra
   lệnh. Bot hiện có nhiều người hỏi (quản lý + trưởng phòng, chốt 01/10). Đề nghị: mỗi tài khoản bot
   có **một chủ sở hữu** nhận bản tin + cảnh báo + ra lệnh gửi; trưởng phòng vẫn hỏi được trong phạm vi
   nhóm mình (theo doc 01), không nhận cảnh báo.
3. **Giờ làm việc và ngưỡng X giờ** cho «chưa trả lời» (đặc tả gợi ý 2 giờ trong giờ làm việc) và giờ gửi
   Morning / EOD Brief (07:30 / 17:30) — cấu hình được, nhưng cần giá trị mặc định.
4. **Bot có được nhắn chủ động vào nhóm không?** Doc 01 chốt «bản đầu không gửi gì vào nhóm». Vài tính năng
   GĐ1 cần bot hỏi trong nhóm («ai phụ trách việc này?» — TN098 là GĐ2) — GĐ1 có thể giữ nguyên: bot chỉ
   nhắn riêng chủ.
5. **Thời hạn lưu**: đặc tả B37 ví dụ 12 tháng; bot mặc định 730 ngày từng nhóm. Cần một con số để ghi vào
   tài liệu PDPL.
6. **Kênh dự phòng Telegram** (doc 01 mục 2) để báo khi Zalo văng (B40): làm trong GĐ1 hay dời GĐ2?

## 5. Những điểm đặc tả chưa nói mà đã gặp khi làm thật

- Zalo **đã đóng đường lấy lịch sử nhóm** (06/2026; đo lại 02/10: API mây trả `isFiltered`, tệp xuất của
  Zalo PC mã hóa toàn bộ). Bù được **khoảng 2 tuần** gần nhất qua Zalo Web (màn Nhập lịch sử, doc 03 mục 5);
  xa hơn thì không. Mọi tiêu chí «dữ liệu 6 tháng» chỉ đúng sau khi bot ở trong nhóm đủ 6 tháng.
- Tài khoản bot là tài khoản Zalo cá nhân chạy qua thư viện không chính thức: có rủi ro bị khóa; đặc tả
  N7 (gửi hàng loạt) làm tăng rủi ro này — cần giãn cách và trần số tin / giờ.
- Mỗi câu hỏi về cùng một tệp hiện nạp lại cả tệp cho mô hình (~31.000 token / lượt với tệp 54 KB). Khi
  dùng nhiều sẽ bật cache ngữ cảnh của Gemini.
- Chất lượng tóm tắt phụ thuộc mô hình: `flash` tóm được nhưng chưa tự chọn ý quan trọng; mẫu Executive
  Summary (TN005) và nâng mô hình cho lượt nặng là hai cách bù.
