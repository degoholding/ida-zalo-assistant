# 06 — Lộ trình Bot trợ lý cho IDA và trạng thái từng việc

> Bản 1.0 · 08/10/2026 · đối chiếu mã `dev1` @ `2cb61ac` (đang chạy trên VPS, botida.degoholding.vn).
> Thay cho mục 7 của [`03-mo-ta-chuc-nang.md`](03-mo-ta-chuc-nang.md). Căn cứ: 27 câu trả lời Q&A của IDA
> (v0.2, phản hồi 07/10/2026), báo cáo tiến độ BC-IDABOT-2026.10.07 và
> [`05-doi-chieu-yeu-cau-ida-global.md`](05-doi-chieu-yeu-cau-ida-global.md).
>
> **Đánh số:** phase đánh số 1–10 từ 08/10/2026 (bản cũ dùng chữ: A=1, B=2, C=3, C2=4, D=5, E=6, F=7, G=8,
> H=9, I=10).
>
> **Cách đọc:** mỗi việc có một trạng thái — **Xong** · **Đang làm** · **Chưa** · **Chờ IDA** (thiếu dữ liệu
> hoặc quyết định từ phía IDA) · **Có mã, chưa bật**. Làm xong việc nào thì sửa đúng dòng đó và ngày xong.

## 0. Đang ở đâu

| Phase | Nội dung | Trạng thái | Việc xong / tổng |
|---|---|---|---|
| **1** | Nền: đồng bộ Zalo, lưu tin / tệp, Danh bạ, trợ lý AI, giao diện web | **Xong** 02/10 | 12 / 12 |
| **2** | Màn Cài đặt + Google Sheets | **Xong** 03/10 | 4 / 4 |
| **+** | Làm thêm ngoài kế hoạch (trợ lý trong nhóm, Google Meet, đọc link, Khóa AI…) | **Xong** 07/10 | 11 / 11 |
| **3** | Hạ tầng xử lý nền (mở rộng cho ~100 nhóm / bot) | **Xong** 08/10 | 12 / 12 |
| **4** | Nhiều tài khoản web, người nhận, tách theo công ty | **Xong** 08/10 | 5 / 5 |
| **5** | N1 — Check tin nhắn và cảnh báo | **Chưa** | 0 / 9 |
| **6** | N4 — Tìm kiếm tin nhắn | Một phần | 1 / 5 |
| **7** | N5 — Checklist công việc | **Chưa** | 0 / 5 |
| **8** | N6 — Bản tin và báo cáo | Một phần | 3 / 7 |
| **9** | N7 — Gửi tin theo lệnh | Một phần | 1 / 6 |
| **10** | N3 Số liệu + N2 Gợi ý trả lời | Một phần | 1 / 9 |

**Một câu:** phần «hỏi gì đáp nấy» (đọc tin, đọc tệp, tóm tắt, xuất Excel / Sheets / PDF) đã chạy thật; nền cho
phần «bot tự theo dõi, tự báo» (phase 3) và tài khoản + 3 người nhận (phase 4) đã xong 08/10 — tiếp theo là phase 5.

Đối chiếu 27 câu của IDA (mục 9): **4 Đạt · 12 Một phần · 11 Chưa** sau phase 4 (báo cáo ngày 07/10 ghi 3 Đạt vì chấm
câu 2 «Đạt»; bản này hạ xuống «Một phần» vì chưa đo tải và chi phí ở 100 nhóm).

## 1. Đã chốt

| Ngày | Quyết định | Ảnh hưởng |
|---|---|---|
| 07/10 | IDA trả lời 27 câu Q&A (giờ làm 08:30–12:00, 13:30–17:30 T2–T7; yên lặng 21:00–06:30; báo thường tối đa 3 lần/ngày; lưu tin 24 tháng, tệp gốc 6 tháng; báo cáo tuần 08:00 T2, tháng ngày 3) | Số liệu điền vào phase 3, 5, 8 |
| 08/10 | **Giai đoạn 1 có 3 người nhận cùng lúc**: Trưởng phòng, CEO, trưởng nhóm (không làm cho 1 người như doc 05 đề xuất) | Thêm phase 4 |
| 08/10 | **Bot được trả lời trong nhóm khi có người gọi.** Bot vẫn không tự lên tiếng trong nhóm (câu 18) | Giữ nguyên tính năng 06/10 |
| 08/10 | **Bot chạy trên VPS riêng** (đại ca đang mua); trong lúc chờ, tạm chạy trên VPS 1 chung với ERP | Mục 10 |
| 08/10 | **Phục vụ IDA trước**; về sau có thể gom vào nền tảng của công ty cho nhiều bên dùng, **tách theo từng công ty** | Phase 4 dựng sẵn khung tách theo công ty |
| 08/10 | Số liệu N3 đọc từ **bảng Google Drive nhân viên nhập mỗi tuần**, không trích từ tin chat | Phase 10 đổi hướng |

## 2. Phase 1 — Nền (Xong)

| Việc | Trạng thái |
|---|---|
| Đăng nhập Zalo bằng QR, phiên lưu mã hóa, nhiều tài khoản bot chạy chung | Xong |
| Nhận diện nhóm, đồng bộ thành viên; bật «Đọc tin» / «Lấy file» từng nhóm (danh sách cho phép) | Xong |
| Lưu tin đủ loại, trích dẫn, @nhắc tên; tin thu hồi xóa chữ, giữ dấu vết | Xong |
| Tin hệ thống của nhóm (vào / rời / đổi tên…) | Xong |
| Tải tệp về kho ngay lúc tin tới, thử lại khi lỗi | Xong |
| Thời hạn lưu từng nhóm (mặc định 730 ngày = 24 tháng), quá hạn tự xóa | Xong |
| Danh bạ: loại người, vai trò, công ty, thẻ | Xong |
| Trợ lý AI qua tin riêng: tóm tắt nhóm, trao đổi với một người, tìm và đọc tệp | Xong |
| Giao diện web khung ERP v2: Hội thoại, Danh bạ, Nhóm, Tệp, Công ty, Tài khoản bot | Xong |
| Gửi tin / tệp từ web dưới tên bot, tin mới hiện tức thời | Xong |
| Nhật ký thao tác, bộ đếm tin ghi sẵn | Xong |
| Nhập lịch sử từ Zalo Web (bù khoảng 2 tuần trước ngày bot vào nhóm) | Xong |

## 3. Phase 2 — Cài đặt + Google Sheets (Xong)

| Việc | Trạng thái |
|---|---|
| Màn Cài đặt sửa trên web, có hiệu lực ngay, khóa bí mật mã hóa | Xong 03/10 |
| Lịch sử thay đổi cài đặt | Xong 03/10 |
| Kết nối Google Sheets bằng service account, nút «Kiểm tra kết nối» | Xong 03/10 |
| Làm lại giao diện màn Cài đặt (tab, thẻ theo chủ đề) | Xong 06/10 |

## 4. Làm thêm ngoài kế hoạch (Xong)

| Việc | Trạng thái |
|---|---|
| Trợ lý trong nhóm: gọi bằng @bot / «bot ơi» / trả lời tin của bot | Xong 06/10 |
| Trong nhóm: tạo nhắc hẹn, ghim ghi chú, bình chọn | Xong 06/10 |
| Nhóm khách hàng: khách gọi thì bot im lặng (06/10); nhóm nội bộ: ai cũng gọi được, tự bật đọc (07/10) | Xong |
| Google Meet: tạo / xem / hủy cuộc họp; recap họp từ ghi âm ra PDF | Xong 06/10 |
| Đọc link Google Sheets / Docs / Drive / trang web (chặn địa chỉ nội bộ) | Xong 07/10 |
| Xuất PDF tóm tắt tài liệu theo khung DEGO | Xong 07/10 |
| Xuất báo cáo Excel / Google Sheets (`export_report`) | Xong 05/10 |
| Quy trình báo cáo 4 bước, cột «Nguồn», Excel nhiều tab, tên tệp theo quy ước IDA | Xong 07/10 |
| Chọn hãng AI (Gemini / trạm tương thích OpenAI), tự lùi khi lỗi | Xong 07/10 |
| Màn **Khóa AI**: nhiều khóa có thứ tự, tự nhảy khóa khi hết tiền / lỗi | Xong 07/10 |
| Kết nối Google bằng tài khoản OAuth để tạo cuộc họp | Xong 07/10 |

## 5. Phase 3 — Hạ tầng xử lý nền (Xong 08/10)

Lý do làm trước: 8 trên 12 câu «Chưa» cần chung bộ lập lịch và cờ trên tin; và với ~100 nhóm / bot thì một
tiến trình làm tất cả (nghe Zalo + web + AI + bóc tệp) không giữ được yêu cầu «báo khẩn trong 1 phút».

**Đã làm (08/10):**
- **Hàng đợi câu hỏi** (bảng `job`, migration 016): câu hỏi gửi bot ghi vào hàng đợi rồi mới trả lời. Bot khởi động
  lại thì câu hỏi còn nguyên; chờ quá 15 phút thì bỏ. Trả lời song song tối đa 6 câu (Cài đặt → «Số câu trả lời chạy
  cùng lúc»); mỗi cuộc trò chuyện trả lời lần lượt; mỗi tin trong nhóm chỉ một bot trả lời. Nằm chờ quá 1 giây thì bot
  nhắn «em nhận được rồi» ngay.
- **Ba tiến trình** trong docker compose: `app` (giữ phiên Zalo, nhận tin, trả lời, web), `worker` (việc nền theo
  lịch), `backup` (sao lưu CSDL). Bóc chữ Excel / Word chạy ở luồng phụ, quá 60 giây thì dừng tệp đó.
- **Bộ lập lịch** + **lịch làm việc** (Cài đặt → tab «Vận hành»): giờ làm 08:30–12:00, 13:30–17:30, thứ 2 – thứ 7;
  giờ yên lặng 21:00–06:30; ngày lễ cố định + kỳ Tết nhập tay. Có hàm đếm «2 giờ LÀM VIỆC» cho đồng hồ chờ của phase 5.
  Việc theo lịch không chạy trùng, tắt máy qua giờ thì bật lên chạy bù; tab «Vận hành» hiện lần chạy gần nhất.
- **Cờ trên từng tin** (bảng `message_flag`: mức ưu tiên, chờ trả lời / đã xem / đã xử lý, ai xử lý, hạn nhắc) và
  **cảm xúc thả lên tin** (bảng `message_reaction`; thả cảm xúc = «đã xem», IDA câu 8). Phase 5 dùng để phân loại và nhắc.
- **Nhóm Mật** (màn Nhóm): công cụ AI không thấy nhóm Mật (danh sách nhóm, tin, tệp, trao đổi với một người, đọc /
  gửi tệp, link); gọi bot trong nhóm Mật thì bot trả một câu cố định, không qua AI.
- **Che dữ liệu cá nhân** trước khi đưa cho AI: số điện thoại, CCCD, số tài khoản (giữ 3 số cuối). Tiền, mã đơn không
  bị che nhầm. Tệp PDF / ảnh / ghi âm gửi nguyên cho mô hình đọc nên không che được.
- **Câu hỏi kỹ thuật thuốc BVTV** (liều lượng, pha trộn, sâu bệnh…): tắt tìm web, chỉ trích tài liệu, luôn kèm
  «cần phòng kỹ thuật xác nhận» (IDA câu 13).
- **Hãng AI được phép** (Cài đặt → Trợ lý AI → «An toàn dữ liệu»): khóa của hãng không được tick thì bot bỏ qua.
- **Kho tệp R2** (bucket `bot-tro-ly-ida`): tệp mới lên R2, tệp cũ trên đĩa vẫn đọc được tới khi lệnh
  `npm run cli -- storage-to-r2` chép hết lên.
- **Hạn giữ tệp gốc** 180 ngày / nhóm (tin vẫn 730 ngày); quá hạn thì xóa tệp gốc, giữ chữ đã bóc; tệp đánh dấu
  «Giữ tệp gốc» ở màn Tệp thì không xóa.
- **Sao lưu CSDL hằng ngày** từ 02:00 (service `backup`, mysqldump), giữ 7 ngày trên đĩa; worker đưa lên R2 và xóa bản
  cũ hơn 30 ngày (Cài đặt → «Giữ bản sao lưu»).
- **Trần token mỗi ngày cho từng bot** (Cài đặt → «Trần token mỗi ngày cho một bot»), cạnh trần cả hệ thống đã có.

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Tách tiến trình: **nhận tin** (app) và **việc nền** (worker), thêm **sao lưu** (backup) | 2, 9 | Xong 08/10 |
| Hàng đợi việc bền, có thử lại, trần song song | 2 | Xong 08/10 |
| Bộ lập lịch: chạy việc theo giờ, tôn trọng giờ làm / giờ yên lặng / Chủ nhật / lễ Tết | 7, 24, 25 | Xong 08/10 |
| Bảng cờ trên tin: mức ưu tiên, trạng thái (chưa trả lời / đã xem / đã xử lý), ai xử lý | 6, 8 | Xong 08/10 (phase 5 bắt đầu ghi cờ) |
| Lưu thả cảm xúc lên tin (tính «đã xem») | 8 | Xong 08/10 |
| Nhãn **Mật** cho nhóm: không gửi AI | 4 | Xong 08/10 (phần «không vào báo cáo cho người khác» làm cùng phase 8) |
| Che SĐT / STK / CCCD trước khi gửi AI; chỉ dùng hãng AI đã duyệt | 4, mục 4 BC | Xong 08/10 |
| Chặn tìm web cho câu hỏi kỹ thuật BVTV | 13 | Xong 08/10 |
| Tệp lưu lên Cloudflare R2 thay vì đĩa VPS | 2, 20 | Xong 08/10 |
| Hạn tệp gốc 6 tháng tách khỏi hạn tin 24 tháng; cờ «giữ» trên tệp | 20 | Xong 08/10 |
| Sao lưu database bot hằng ngày | 2 | Xong 08/10 |
| Trần token AI theo ngày cho từng bot | 2 | Xong 08/10 |
| Phân loại tin bằng từ khóa trước, AI gom lô sau | 2, 6 | Chuyển sang phase 5 (là phần của bộ phân loại) |

## 6. Phase 4 — Tài khoản, người nhận, tách theo công ty (Xong 08/10)

**Đã làm (08/10):**
- **Đăng nhập bằng Google** ở màn đăng nhập — dùng chung Client ID đăng nhập Google của ERP (Cài đặt → Google →
  «Client ID đăng nhập Google»). Chỉ email có ở màn **Người dùng** và đang bật mới vào được. Mật khẩu quản trị
  (ADMIN_PASSWORD) giữ làm đường dự phòng. Phiên đăng nhập lưu CSDL — deploy không văng mọi người.
- **Người dùng theo vai trò** (màn Người dùng, chỉ quản trị): Quản trị (toàn quyền) · Quản lý (xem + sửa nhóm, Danh bạ,
  tệp trong phạm vi, gửi tin dưới tên bot) · Nhân viên (chỉ xem trong phạm vi). Đổi vai trò / tắt / đổi phạm vi thì
  phiên đang mở của người đó văng ngay. Nhật ký thao tác ghi đúng tên người làm.
- **Phạm vi nhóm**: người không phải quản trị chỉ thấy nhóm được gán — danh sách nhóm, hội thoại, tệp, Danh bạ, ô chọn,
  tin đẩy tức thời; mở thẳng đường dẫn nhóm khác thì như không có (404). Cài đặt, Khóa AI, tài khoản bot, người dùng,
  người nhận, nhật ký: chỉ quản trị. Đường API mới mà quên khai quyền thì mặc định chỉ quản trị.
- **Người nhận** (màn Người nhận, chỉ quản trị): người trên Zalo (kênh nhắn riêng của bot), chức danh, thứ tự ưu tiên,
  nhóm theo dõi (hoặc mọi nhóm), danh sách VIP (tối đa 50), giờ bản tin sáng / cuối ngày, có báo ngay tin khẩn không.
  Nút «Gửi thử» nhắn một tin vào chat riêng của người đó để kiểm kênh. Người nhận luôn được bot trả lời tin riêng.
- **Khung tách theo công ty**: bảng `tenant` (dòng IDA), người dùng và người nhận mang `tenant_id`.

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Web nhiều tài khoản, mỗi người một vai trò, đăng nhập Google | 1, 10 | Xong 08/10 |
| Hồ sơ **người nhận**: 3 người (Trưởng phòng, CEO, trưởng nhóm), mỗi người một bộ nhóm theo dõi, danh sách VIP, giờ nhận bản tin | 1, 5, 24 | Xong 08/10 |
| Kênh lệnh riêng: chat riêng giữa người nhận và bot là nơi nhận báo và ra lệnh | 9 | Xong 08/10 (gửi báo + người nhận luôn hỏi được bot; lệnh cụ thể ở phase 5–9) |
| Phạm vi xem trên web theo người (mỗi người chỉ thấy nhóm của mình) | 1, 4 | Xong 08/10 |
| **Khung tách theo công ty**: bảng mới mang mã công ty ngay từ đầu | — | Xong 08/10 |

## 7. Phase 5 — N1 Check tin nhắn và cảnh báo (Chưa)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Danh sách **VIP** (20–30 người) trên Danh bạ, có tác dụng thật | 5 | Chưa |
| Từ khóa KHẨN / QUAN TRỌNG sửa trên Cài đặt; so đúng dấu, nguyên từ (tránh «la» khớp «là», «ngay», «liền» báo giả) | 6 | Chưa |
| AI nhận tin khẩn không chứa từ khóa (báo trong 5–10 phút) | 6 | Chưa |
| Nhận ra tin @nhắc tên hoặc hỏi thẳng người nhận | 7 | Chưa |
| Đồng hồ chờ: 2 giờ làm việc; VIP 30 phút; câu hỏi của khách chưa ai trả lời | 7 | Chưa |
| Xác định «đã xử lý»: trả lời trích dẫn / nhắc tên người hỏi / đánh dấu xong trên bot | 8 | Chưa |
| Đẩy tin KHẨN / VIP ngay (gộp tin trong 2 phút); báo khác tối đa 3 lần/ngày | 9 | Chưa |
| «Có gì cần xử lý» — danh sách tin theo mức ưu tiên | N1 | Chưa |
| Báo người nhận + IT khi phiên Zalo văng, qua kênh dự phòng | 9 | Chưa (hiện chỉ hiện trạng thái trên web) |

## 8. Phase 6–10

### Phase 6 — N4 Tìm kiếm (Một phần)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Tìm tệp theo tên và nội dung đã bóc (`search_files`) | 21 | Xong |
| Chỉ mục toàn văn cho tin nhắn, tìm ≤ 5 giây trên 6 tháng dữ liệu | 21 | Chưa |
| Công cụ trợ lý tìm tin theo từ khóa + người + nhóm + ngày | 21 | Chưa |
| Màn tìm tin trên web, nút «xem các tin trước và sau» | 21 | Chưa |
| Tìm bằng câu tự nhiên (giai đoạn 2) | 21 | Chưa |

### Phase 7 — N5 Checklist (Chưa)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Bảng việc (việc, người, hạn, trạng thái, tin nguồn) + màn web | 22 | Chưa |
| Bot đề xuất việc từ tin nhắn, người nhận xác nhận mới vào checklist | 22 | Chưa |
| Cập nhật bằng câu tự nhiên («xong việc…», «dời hạn…») | 22 | Chưa |
| Nhắc người nhận 3 mốc: trước hạn 1 ngày, đúng hạn, quá hạn | 23 | Chưa |
| Nhắc người phụ trách khi người nhận ra lệnh và xác nhận | 23 | Chưa |

### Phase 8 — N6 Bản tin và báo cáo (Một phần)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Báo cáo theo yêu cầu ra Excel / Google Sheets | 19 | Xong 05/10 |
| PDF tóm tắt theo khung DEGO | 25 | Xong 07/10 |
| Tên tệp theo quy ước «Tên công việc - Thời gian - Tên nhân viên» | 25 | Xong 07/10 |
| Bản tin sáng 07:30, 5 mục, gọn một màn hình điện thoại | 24 | Chưa |
| Bản tin cuối ngày 17:30 | 24 | Chưa |
| Báo cáo tuần 08:00 thứ 2, báo cáo tháng ngày 3: 1 trang A4 + Excel, tự gửi | 25 | Chưa |
| Khuôn báo cáo tuần / tháng theo form IDA | 25 | Chờ IDA (form gửi sau) |

### Phase 9 — N7 Gửi tin theo lệnh (Một phần)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Quản trị gửi chữ / tệp từ web dưới tên bot | 26 | Xong |
| Ra lệnh gửi từ Zalo bằng câu tự nhiên → xem trước → xác nhận → gửi → báo kết quả | 26 | Chưa |
| Hẹn giờ gửi, hủy lệnh | 26 | Chưa |
| Tắt bot khẩn bằng lệnh | N7 | Chưa |
| Nhật ký gửi (thành công / lỗi) | 26 | Chưa |
| Gửi hàng loạt có giới hạn tốc độ (giai đoạn 2) | 26 | Chưa |

### Phase 10 — N3 Số liệu + N2 Gợi ý trả lời (Một phần)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Đọc link Google Sheets khi được hỏi (`read_link`) | 14 | Xong 07/10 |
| Đọc định kỳ các bảng Drive nhân viên nhập (NKCV, BC-Tồn kho, BCSale, BC-T2), lưu số vào database | 14, 15 | Chờ IDA (link bảng thật) |
| Bảng tổng hợp theo ngày × nhân viên × khu vực, dòng tổng, so kỳ trước; cờ số âm, lệch ±30%, chưa báo sau 18:00 | 15 | Chưa |
| Nạp file KPI tháng, so thực hiện với kế hoạch | 17 | Chờ IDA (file KPI) |
| Nạp danh mục nhân viên và đại lý từ Excel; thêm vùng sales, người phụ trách vào Danh bạ | 16 | Chờ IDA (2 file Excel) |
| Thư viện mẫu C10 (15 mẫu): nhân viên soạn, quản lý duyệt | 10 | Chưa |
| 2–3 bản nháp trả lời khác tông theo mẫu, đúng văn phong; thiếu số thì để «[cần bổ sung]» | 11, 12 | Chưa |
| Kho tài liệu kỹ thuật đã duyệt; câu kỹ thuật chỉ trích tài liệu + «cần kỹ thuật xác nhận» | 13 | Chờ IDA (bộ tài liệu) |
| Nối Misa / app Thu mua / ERP | 27 | Giai đoạn sau |

## 9. Đối chiếu 27 câu IDA

| Câu | Nội dung | Phase | Trạng thái |
|---|---|---|---|
| 1 | 3 người nhận | 4 | Đạt (08/10) |
| 2 | ~100 nhóm / bot | 3 | Một phần |
| 3 | Nhóm có / không có quyền trưởng nhóm | 1 | Đạt |
| 4 | Không đọc / Mật / tiếng nước ngoài | 1, 3 | Một phần (nhãn Mật xong 08/10; còn loại khỏi báo cáo ở phase 8) |
| 5 | VIP | 5 | Chưa |
| 6 | Từ khóa KHẨN / QUAN TRỌNG | 5 | Chưa |
| 7 | Đồng hồ chờ, giờ làm, giờ yên lặng | 3, 5 | Chưa |
| 8 | Thế nào là «đã xử lý» | 3, 5 | Chưa |
| 9 | Đẩy báo, trần 3 lần/ngày, báo phiên văng | 5 | Chưa |
| 10 | Thư viện mẫu C10 có duyệt | 4, 10 | Chưa |
| 11 | Văn phong | 10 | Một phần |
| 12 | Không tự điền số | 10 | Một phần |
| 13 | Kỹ thuật BVTV | 3, 10 | Một phần (chặn tìm web + luật trích tài liệu 08/10; còn kho tài liệu duyệt) |
| 14 | Bảng Drive mỗi tuần | 10 | Một phần |
| 15 | Chỉ tiêu bảng sales | 10 | Một phần |
| 16 | Danh mục nhân viên / đại lý | 10 | Một phần |
| 17 | File KPI | 10 | Chưa |
| 18 | Số mơ hồ: gắn cờ, báo người nhận | 5, 10 | Một phần |
| 19 | Excel qua Zalo + lưu web | 8 | Đạt |
| 20 | Lưu 24 tháng / tệp 6 tháng | 1, 3 | Đạt (08/10) |
| 21 | Tìm tin + xem trước / sau | 6 | Một phần |
| 22 | Checklist | 7 | Chưa |
| 23 | Nhắc hạn | 7 | Chưa |
| 24 | Bản tin sáng | 8 | Chưa |
| 25 | Báo cáo tuần / tháng | 8 | Một phần |
| 26 | Gửi theo lệnh | 9 | Chưa |
| 27 | Misa, Drive, sau nối Thu mua / ERP | 10 | Một phần (đọc được Drive; chưa nối Misa / Thu mua / ERP) |

## 10. Máy chủ

| Việc | Trạng thái |
|---|---|
| Bot chạy trên VPS 1 (chung ERP), tên miền botida.degoholding.vn qua Cloudflare | Xong 07/10 (tạm) |
| VPS riêng cho bot (đề xuất 4 lõi CPU, 8 GB RAM, 100 GB SSD) | Đang làm — đại ca đang mua |
| Tệp lên R2 (bucket `bot-tro-ly-ida`, token «ERP-doc-file-app-cu» được cấp đọc + ghi 08/10) | Xong 08/10 |
| Chuyển bot sang VPS riêng (database + tệp + phiên Zalo) | Chưa |
| Mỗi bot thêm một tài khoản Zalo dự phòng trong cùng các nhóm | Chưa |
| Bật Cloudflare Access chắn trang quản trị | Chưa |

Ước lượng cho một bot 100 nhóm ở mức «vừa» (20–100 tin / nhóm / ngày): 2.000–10.000 tin / ngày; 24 tháng
khoảng 1,5–7 triệu tin (2–7 GB database); ảnh / tệp giữ 6 tháng khoảng 10–55 GB — vì vậy tệp phải lên R2.

## 11. Đang chờ

| Ai | Việc |
|---|---|
| IDA | Link các bảng Google Drive thật (bản chép đang lỗi #REF!), chia sẻ quyền xem cho tài khoản dịch vụ của bot |
| IDA | 30–50 tin báo cáo thật kèm số đúng (bộ đo «trích đúng ≥ 95%») |
| IDA | Danh sách VIP; danh mục nhân viên và đại lý; file KPI; bộ tài liệu kỹ thuật và nhãn sản phẩm; form báo cáo tuần / tháng |
| Đại ca | Đổi khóa modelapi (đã lộ trong chat); nạp tiền khóa Gemini; bật Cloudflare Access; VPS riêng |
