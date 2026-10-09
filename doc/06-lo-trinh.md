# 06 — Lộ trình Bot trợ lý cho IDA và trạng thái từng việc

> Bản 1.3 · 09/10/2026 (phase 7 checklist) · bản 1.2 09/10/2026 (phase 6 sửa sau review: bảng tìm riêng, chống sập MySQL) · bản 1.1 09/10/2026 (phase 6) · bản 1.0 08/10/2026 · đối chiếu mã `dev1` @ `2cb61ac` (đang chạy trên VPS, botida.degoholding.vn).
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
| **5** | N1 — Check tin nhắn và cảnh báo | **Xong** 08/10 | 9 / 9 |
| **11** | Ticket qua bot (đại ca thêm 08/10, làm trước phase 6) | **Xong** 08/10 | 7 / 7 |
| **6** | N4 — Tìm kiếm tin nhắn | **Xong** 09/10 (phần GĐ1) | 5 / 6 |
| **7** | N5 — Checklist công việc | **Xong** 09/10 | 5 / 5 |
| **8** | N6 — Bản tin và báo cáo | Một phần | 3 / 7 |
| **9** | N7 — Gửi tin theo lệnh | Một phần | 1 / 6 |
| **10** | N3 Số liệu + N2 Gợi ý trả lời | Một phần | 1 / 9 |

**Một câu:** phần «hỏi gì đáp nấy» (đọc tin, đọc tệp, tóm tắt, xuất Excel / Sheets / PDF) đã chạy thật; nền cho
phần «bot tự theo dõi, tự báo» (phase 3), tài khoản + 3 người nhận (phase 4) và check tin + cảnh báo (phase 5) đã xong
08/10; tìm tin (phase 6) và checklist công việc (phase 7) xong 09/10 — tiếp theo là phase 8 (bản tin và báo cáo).

Đối chiếu 27 câu của IDA (mục 9): **11 Đạt · 12 Một phần · 4 Chưa** sau phase 7 (báo cáo ngày 07/10 ghi 3 Đạt vì chấm
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
| 08/10 | **Ticket qua bot**: việc chung của IDA, **chỉ trong bot, không nối ERP**; người xử lý do đại ca gửi tên; làm ngay | Thêm phase 11 (làm trước phase 6) |

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
  «Client ID đăng nhập Google»). Chỉ email có ở màn **Người dùng** và đang bật mới vào được. Phiên đăng nhập lưu
  CSDL — deploy không văng mọi người.
- **Tên đăng nhập + mật khẩu riêng từng người** (đại ca chốt 08/10, bỏ mật khẩu quản trị chung ADMIN_PASSWORD): quản
  trị đặt / đặt lại ở màn Người dùng; sai 5 lần / 15 phút thì khóa theo máy và theo tên đăng nhập. Tài khoản `admin`
  quyền cao nhất; 102 nhân sự IDA đang làm (email có «ida» trong ERP) được tạo sẵn: tên đăng nhập = mật khẩu = email,
  vai trò Nhân viên, thấy mọi nhóm, đăng nhập Google được. Đường cứu: `node dist/cli.js user-admin` / `user-password`.
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

## 7. Phase 5 — N1 Check tin nhắn và cảnh báo (Xong 08/10)

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Danh sách **VIP** (20–30 người) có tác dụng thật | 5 | Xong 08/10 (VIP riêng từng người nhận, sửa ở màn Người nhận hoặc nhắn bot; chờ IDA gửi danh sách) |
| Từ khóa KHẨN / QUAN TRỌNG sửa trên Cài đặt; so đúng dấu, nguyên từ (tránh «la» khớp «là», «ngay», «liền» báo giả) | 6 | Xong 08/10 (từ «nghiêm» la / liền / ngay chỉ tính khi AI xác nhận) |
| AI nhận tin khẩn không chứa từ khóa (báo trong 5–10 phút) | 6 | Xong 08/10 (AI xét theo lô 5 phút / lần; không đưa nhóm Mật; che SĐT / STK) |
| Nhận ra tin @nhắc tên hoặc hỏi thẳng người nhận | 7 | Xong 08/10 |
| Đồng hồ chờ: 2 giờ làm việc; VIP 30 phút; câu hỏi của khách chưa ai trả lời | 7 | Xong 08/10 |
| Xác định «đã xử lý»: trả lời trích dẫn / nhắc tên người hỏi / đánh dấu xong trên bot | 8 | Xong 08/10 |
| Đẩy tin KHẨN / VIP ngay (gộp tin trong 2 phút); báo khác tối đa 3 lần/ngày | 9 | Xong 08/10 (giờ yên lặng chỉ báo KHẨN / VIP) |
| «Có gì cần xử lý» — danh sách tin theo mức ưu tiên | N1 | Xong 08/10 (nhắn riêng bot; màn web để sau) |
| Báo người nhận + IT khi phiên Zalo văng, qua kênh dự phòng | 9 | Xong 08/10 (Telegram; báo một lần khi văng, một lần khi nối lại) |
| Quản lý / trưởng phòng / người nhận đổi cấu hình cảnh báo bằng cách nhắn riêng bot (xem trước → xác nhận ở tin sau) | N1 | Xong 08/10 (làm thêm) |

## 7b. Phase 11 — Ticket qua bot (Xong 08/10)

Nhân viên báo việc cần hỗ trợ / lỗi / sự cố cho bot; bot ghi nhận, báo người xử lý, báo lại người gửi khi có tiến triển.
Mã: `src/tickets/`, lệnh ở `src/assistant/chat-commands.ts`, API `src/web/api/tickets-api.ts`, migration 022.

| Việc | Trạng thái |
|---|---|
| Báo ticket: «báo lỗi: …» trong tin riêng hoặc gọi bot trong nhóm; ảnh gửi trước đó 15 phút tự gắn vào ticket; mã T-0001 | Xong 08/10 |
| Ai nhắn được cho bot (kể cả khách) hoặc gọi bot trong nhóm đều báo / theo dõi ticket được (chỉ lệnh ticket + «hướng dẫn») | Xong 08/10 |
| Người gửi tự báo xong («báo xử lý xong T1»); Quản lý / Trưởng phòng xem mọi ticket; chữ «…» trên Zalo thành in đậm | Xong 08/10 |
| Báo người xử lý qua Zalo (chữ + ảnh), nhiều người; danh sách người xử lý sửa trên màn Ticket | Xong 08/10 |
| Người xử lý «nhận T-12», «xong T-12 <ghi chú>», «T-12: <nhắn người gửi>», «ticket» (đang mở) | Xong 08/10 |
| Báo lại người gửi đúng chỗ đã báo (tin riêng / nhóm) khi nhận, xong, hủy, có lời nhắn | Xong 08/10 |
| Người gửi «T-12» xem tình hình, «T-12: …» bổ sung (ticket đã xong thì mở lại), «hủy T-12» | Xong 08/10 |
| Màn Ticket trên web: danh sách, chi tiết, ảnh, nhật ký, nhận / xong / hủy / mở lại / nhắn người gửi | Xong 08/10 |

## 8. Phase 6–10

### Phase 6 — N4 Tìm kiếm (Xong 09/10, phần GĐ1)

**Đã làm (09/10):**
- **Bảng tìm riêng `message_search`** (migration 023: chữ tin + nhóm + giờ gửi, chỉ mục toàn văn bộ tách theo khoảng trắng,
  collation `utf8mb4_0900_ai_ci` để gõ không dấu khớp có dấu **kể cả «đ» = «d»**). KHÔNG thêm FULLTEXT thẳng vào `message`:
  việc đó dựng lại cả bảng và chặn ghi suốt lúc dựng (bảng càng lớn bot càng đứng lâu). Migration chỉ tạo bảng rỗng — đo
  trên bảng 300 nghìn tin: 57 ms. Tin mới ghi vào bảng tìm ngay lúc lưu (`indexMessage` trong `message-ingest.ts`, thu hồi thì
  bỏ ra, xóa tin thì khóa ngoại tự xóa); tin cũ do việc nền «search-index» (mỗi phút, ≤ 40 giây / lượt) chép theo lô 5.000 id
  từ mới về cũ — đo ~38.000 tin / giây (1 triệu tin ~26 giây), ghi tin mới trong lúc chép: trung vị 3 ms, chậm nhất 54 ms.
  Chưa chép xong thì màn «Tìm tin» và trợ lý báo «mới tìm được từ khoảng ngày …». Không dùng trigger: binlog bật thì user
  ứng dụng (không SUPER) không tạo được. Mã: `src/search/message-search-index.ts`.
- Mỗi từ khóa bắt buộc, cụm trong ngoặc kép giữ thứ tự; từ toàn dấu câu / emoji bị bỏ. **MATCH chỉ nhận chữ đơn**
  (`+công +nợ`), thứ tự cụm kiểm lại bằng LIKE: đo 09/10 trên 300 nghìn tin, MATCH cụm (`+"công nợ"`) dùng bộ nhớ vượt trần
  và làm MySQL bị giết. Lõi chung: `src/search/message-search.ts`.
- **Không dùng bộ tách ngram**: đo trên 1 triệu tin giả, ngram tách thành cặp 2 ký tự («ng», «nh» có trong gần như mọi tin)
  → một câu tìm làm MySQL hết 768 MB và bị giết. Cấu hình MySQL đi kèm (docker-compose.yml): `innodb_ft_min_token_size=1`,
  `innodb_ft_enable_stopword=OFF`, **trần bộ nhớ mỗi câu tìm 32 MB** (vượt thì câu tìm báo lỗi, bot lùi về LIKE; 64 MB × 2
  câu cùng lúc trên 1 triệu tin đã làm MySQL bị giết, 32 MB thì 6 câu dồn cùng lúc vẫn ~600 MB).
- **Tự lùi về quét LIKE trong 90 ngày gần nhất** (đi theo chỉ mục giờ gửi) khi từ khóa quá phổ biến (vượt trần), quá ngắn,
  hoặc MySQL chưa đổi cấu hình (bot tự đọc `@@innodb_ft_*`); kết quả báo «chỉ tìm các tin từ ngày …». Chỉ chọn «đến ngày»
  thì 90 ngày tính lùi từ ngày đó. Mỗi câu tìm có trần 5 giây (`MAX_EXECUTION_TIME`, quá thì báo «thu hẹp lại»); màn web
  đếm tối đa 1.000 kết quả; lọc «Lúc gửi» theo ngày lấy trọn ngày giờ Việt Nam.
- **Số đo chịu tải (đo lại 09/10 sau review, dữ liệu giả CỰC ĐOAN: 30 chữ, chữ nào cũng có trong gần như mọi tin)**:
  300 nghìn tin — mọi câu 0,4–0,7 giây, 6 câu dồn cùng lúc 1,2 giây, MySQL ~660 MB; 1 triệu tin (trần 32 MB) — 6 câu
  dồn cùng lúc 0,35 giây (chữ quá phổ biến tự lùi LIKE), câu đầu tiên lúc bộ đệm nguội ~1,5 giây, MySQL ~600 MB, không
  sập. Lần đo 1.1 («1 triệu tin < 1 giây, không sập») chưa thử câu cụm + nhiều câu cùng lúc — đo lại đã làm MySQL bị giết
  trước khi sửa (MATCH chữ đơn, trần 32 MB, tối đa 2 câu). Dữ liệu thật ít chữ phổ biến hơn nên ít phải lùi LIKE hơn.
- `search_index_meta` ghi `innodb_ft_min_token_size` LÚC TẠO bảng tìm: đổi cấu hình MySQL về sau thì từ ngắn tự đi LIKE
  (không ra rỗng). Muốn bảng tìm nhận từ ngắn theo cấu hình mới: `TRUNCATE message_search; UPDATE search_index_meta SET
  min_token_size = @@innodb_ft_min_token_size, backfill_next_id = NULL, backfilled_at = NULL` — việc nền tự chép lại (bảng
  `message` không bị khóa).
- **Chịu tải 100 nhóm cùng gọi bot** (giả lập 09/10 bằng đúng `ZaloSender`, AI giả ~2,5 giây / lượt, tìm thật trên DB):
  nút thắt là **hàng gửi Zalo** (1 tin / 1,5 giây / tài khoản để không bị khóa), không phải AI hay hàng đợi câu hỏi — tăng 6 → 30
  câu song song không nhanh thêm giây nào. Đã sửa: (1) tin «chờ em xíu» gửi bằng `sendIfQuiet` — hàng gửi đông (> 2 tin) thì
  bỏ; (2) câu trả lời đi TRƯỚC tin «chờ» trong hàng gửi; (3) lượt tự bỏ (trả null) không chiếm 1,5 giây giãn cách;
  (4) tối đa 2 câu tìm chạy cùng lúc trong MySQL (`searchLimiter`; mỗi câu toàn văn được dùng tới 32 MB — 100 câu cùng lúc
  không giới hạn sẽ vượt 768 MB). Kết quả: nhóm chờ lâu nhất 303 → 157 giây (1 tài khoản), 87 giây nếu 2 tài khoản chia
  nhóm; ngày thường (5 nhóm) vẫn thấy «chờ em xíu» sau ~4 giây, có câu trả lời sau 9–12 giây. 100 câu tìm thật cùng lúc: xong
  trong 0,23 giây (đo trước khi đổi sang bảng tìm riêng, lúc còn cho 3 câu cùng lúc). Muốn nhanh hơn nữa: thêm tài khoản Zalo
  (mục 10); không hạ 1,5 giây vì Zalo không công bố ngưỡng chống spam.
- Review code (agent, 09/10): không thấy lỗi tiêm SQL / lộ phạm vi; 10 điểm (cửa sổ ngày, đ/d, dấu câu, trần thời gian, cấu hình
  lúc dựng chỉ mục…) đã sửa cùng ngày. Kèm theo: `npm test` trước đây bỏ sót các tệp test sâu 2 cấp (`src/web/api/*.test.ts`,
  sh hiểu `**` như `*`) — đã sửa, bộ test từ 315 lên 343.
- **Review lần 2 (09/10)**: (1) tin «chờ em xíu» gửi lúc câu hỏi còn nằm trong hàng đợi giờ cũng tự bỏ nếu tới lượt mà câu
  trả lời đã có — hàng gửi ưu tiên làm câu trả lời chen trước, tin chờ từng tới SAU câu trả lời (`AckState.answered`);
  (2) màn «Tìm tin» hiện ghi chú khi máy chủ tự giới hạn và câu lỗi 422 đúng nghĩa (khung CRUD thêm `listNotice`,
  `describeListError`); (3) chỉ chọn «đến ngày» không còn ra rỗng; (4) đổi FULLTEXT trên `message` sang bảng tìm riêng (không
  khóa bảng khi migrate); (5) chống sập MySQL khi tìm cụm / nhiều câu cùng lúc; (6) ẩn nhóm đã tắt «Đọc tin». Bộ test 354
  (3 bài `src/cpu/cpu-pool.test.ts` trượt từ trước — luồng phụ không nạp được `.ts`, chưa sửa).
- **Màn «Tìm tin»** (menu trái, quyền xem hội thoại, đúng phạm vi nhóm của từng người, nhóm đã tắt «Đọc tin» không hiện
  như màn Hội thoại): từ khóa + lọc cuộc trò chuyện / người gửi / khoảng ngày; đoạn trích tô sáng từ khóa; «Xem trong hội
  thoại» mở đúng tin cùng các tin trước và sau. Dòng ghi chú trên bảng khi máy chủ tự giới hạn (đang chép tin cũ, chỉ dò từ
  ngày …, hơn 1.000 tin); lỗi «tìm lâu quá» hiện đúng câu hướng dẫn. Chỉ chọn «Lúc gửi ≤ ngày» thì cửa sổ 90 ngày tính lùi từ
  ngày đó (trước đây tính từ hôm nay → ra rỗng).
- **Công cụ trợ lý `search_messages`**: «ai nhắc tới hợp đồng thép», «tìm tin về công nợ Minh Phát»… — chỉ nhóm đang đọc, không
  bao giờ nhóm Mật hay tin riêng; hỏi trong nhóm thì chỉ tìm trong nhóm đó.

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Tìm tệp theo tên và nội dung đã bóc (`search_files`) | 21 | Xong |
| Chỉ mục toàn văn cho tin nhắn, tìm ≤ 5 giây trên 6 tháng dữ liệu | 21 | Xong 09/10 (đo 1 triệu tin giả cực đoan: ≤ 1,5 giây, không sập) |
| Bảng tìm riêng, chép tin cũ trong nền (migrate không khóa bảng `message`) | 21 | Xong 09/10 |
| Công cụ trợ lý tìm tin theo từ khóa + người + nhóm + ngày | 21 | Xong 09/10 |
| Màn tìm tin trên web, nút «xem các tin trước và sau» | 21 | Xong 09/10 |
| Tìm bằng câu tự nhiên (giai đoạn 2) | 21 | Một phần (trợ lý hiểu câu hỏi tự nhiên rồi tự chọn từ khóa; chưa tìm theo nghĩa) |

### Phase 7 — N5 Checklist (Xong 09/10)

Plan: `plans/261009-1416-phase-07-checklist/` · kịch bản test khi deploy (phase 6 + 7): [`07-kich-ban-test-phase-6-7.md`](07-kich-ban-test-phase-6-7.md). **Đã chốt (đại ca, 09/10):** nhắc 3 mốc gửi NGƯỜI PHỤ TRÁCH (tag trong nhóm
nguồn, không ở nhóm thì nhắn riêng), quá hạn báo thêm người giao + sếp (chung trần 3 báo / ngày); việc vào từ lệnh / câu tự
nhiên + recap họp + AI tự bắt; việc AI bắt phải được NGƯỜI GIAO (hoặc sếp) xác nhận mới vào checklist.

**Đã làm (09/10):**
- **Bảng việc** (migration 024: `task` + nhật ký `task_event`), mã `V-12`, trạng thái chờ xác nhận / đang làm / xong / hủy,
  ưu tiên, người phụ trách + người giao (người trên Zalo), nhóm + tin nguồn, hạn (ngày hoặc ngày giờ). Một service cho Zalo
  và web (`src/tasks/task-service.ts`, khuôn ticket); báo tin qua hàng đợi `job` — trong nhóm thì TAG người đó (Zalo báo cho
  họ; `sendThreadText` nay gắn được thẻ nhắc).
- **Lệnh gõ** (có dấu hay không): «việc», «việc nhóm», «việc quá hạn», «việc chờ xác nhận», «giao Minh: <việc> hạn thứ 6»,
  «xong V-12 <ghi chú>», «dời V-12 mai 17h», «giao lại V-12 <tên>», «hủy V-12», «mở lại V-12», «ok / bỏ V-12», «V-12: …»,
  «V-12». Đọc hạn: hôm nay / mai / mốt / thứ 2…CN / tuần sau / dd/mm[/yyyy] / giờ «17h30», «3h chiều» / cuối tuần / cuối tháng;
  không hiểu thì hỏi lại, không đoán. «giao hàng: …» không bị hiểu nhầm là giao việc (tên phải viết hoa hoặc «giao cho / @»).
- **Câu tự nhiên** qua công cụ trợ lý `list_tasks` / `create_task` / `task_action` — đi đúng đường lệnh gõ, cùng luật quyền.
  **Recap họp** hỏi «lưu các việc này vào checklist và nhắc theo hạn?» → `save_recap_tasks` (thay nhắc hẹn Zalo lặp hằng ngày).
- **Quyền**: sếp (có vai trò / người nhận) làm mọi thứ; người giao: dời hạn, giao lại, hủy, xác nhận; người phụ trách: xong,
  ghi chú; trong nhóm chỉ thấy việc của nhóm đó. Chỉ nhân sự / sếp được giao việc (khách nhắn «giao …» bị chặn); người phụ
  trách chưa có vai trò vẫn nhắn riêng «xong V-12» được (cổng tin riêng mở cho lệnh việc).
- **Nhắc 3 mốc** (worker mỗi phút, `task-reminders`): đầu giờ làm ngày làm việc liền trước ngày hạn · đầu giờ làm ngày hạn ·
  quá hạn (hạn có giờ: sau 1 giờ làm việc; hạn chỉ ngày: đầu giờ ngày làm việc kế tiếp). Gộp mọi việc của một người trong
  một nhóm thành MỘT tin; mỗi mốc một lần; chỉ gửi mốc cao nhất (bot tắt mấy ngày không gửi bù); không nhắc giờ yên lặng /
  ngày nghỉ; giao / dời hạn sau một mốc thì bỏ mốc đó. Quá hạn: người giao nhận tin riêng, sếp theo dõi nhóm nhận «VIỆC QUÁ
  HẠN» (loại báo `TaskOverdue`, chung trần với nhắc tin chờ).
- **AI tự bắt câu giao việc** (worker 5 phút, `task-extract`): lượt RIÊNG (lượt AI bắt tin khẩn bỏ qua tin đã dính từ khóa
  «công nợ», «hóa đơn» — đúng chỗ hay có câu giao việc); chỉ tin của nhân sự / sếp có dấu hiệu giao việc (@nhắc, «nhờ»,
  «giao», «hạn», «trước thứ…») mới đưa AI; che dữ liệu cá nhân, không đưa nhóm Mật, tính vào trần token ngày. Đề xuất → việc
  «chờ xác nhận», nhắn riêng NGƯỜI NÓI câu đó; «ok V-12» → vào checklist, tag người làm. ~2 ngày làm việc không ai xác nhận
  → tự bỏ. Một câu chỉ sinh một đề xuất dù lượt chạy lại.
- **Màn web «Việc»** (menu trái, quyền `task`: mọi vai trò xem trong phạm vi nhóm, quản trị + quản lý sửa / tạo): danh sách
  (mặc định chờ xác nhận + đang làm, hạn gần nhất trước; lọc trạng thái, quá hạn, thiếu người, thiếu hạn, người phụ trách,
  nhóm, hạn), chi tiết + «Xem tin nguồn» + nhật ký, nút xác nhận / bỏ / xong / dời hạn / giao lại / hủy / mở lại / ghi chú
  (đi đúng service như trên Zalo, có «Lịch sử thao tác»), tạo việc trên web. Việc không gắn nhóm chỉ người dùng không bị giới
  hạn nhóm thấy. Dòng thời gian sự kiện dùng chung với Ticket (`web/src/shared/event-timeline/`). Kèm sửa: màn Ticket từng
  lỗi «Lịch sử thao tác» (API không nhận thực thể `ticket`).
- Chạy thật trên DB local (mô hình AI giả cho lượt bắt việc): giao trong nhóm → tag đúng người; khách bị chặn; người ngoài
  không thấy việc; nhắc gộp «quá hạn + tới hạn hôm nay»; chạy lại không gửi trùng; đề xuất → «ok» → vào checklist.
- **Review (agent, 09/10) — đã sửa:** (1) khóa chống trùng của tin nhắc gồm cả hạn + người phụ trách (dời hạn / giao lại rồi
  tới cùng mốc thì tin nhắc mới từng bị nuốt im lặng 14 ngày); (2) chỉ TAG trong nhóm NỘI BỘ bot còn ở — nhóm khách hàng không
  bao giờ thấy việc nội bộ, nhắn riêng thay; (3) hạn «dd/mm» lùi quá 7 ngày hiểu là năm sau, hạn vô lý (trước hôm qua / quá
  2 năm) bị từ chối, hạn đã qua lúc giao thì coi như đã nhắc quá hạn (không bắn tin cho 3 bên); (4) đổi trạng thái kèm điều
  kiện «trạng thái vẫn như lúc đọc» (hai người cùng bấm không ghi đè nhau); (5) lưu recap chống tạo trùng + MỘT tin gộp vào
  nhóm thay vì tối đa 30 tin; (6) lượt bắt việc không bỏ sót khi lô bị cắt, tin đề xuất giờ yên lặng hoãn tới đầu giờ làm;
  (7) «v3», «ok v2» trong câu thường không còn bị hiểu là lệnh; «xong V-12 rồi nhé» không lưu «rồi nhé» làm ghi chú; đọc được
  hạn đúng dạng bot in («T6 16/10»). **Chưa làm:** giới hạn số lệnh việc có báo tin / người / giờ (lệnh gõ chưa tính vào trần
  câu hỏi / giờ); sếp vượt trần ngày thì việc quá hạn lượt đó không báo sếp (chưa có bản tin gom — phase 8).

| Việc | Câu IDA | Trạng thái |
|---|---|---|
| Bảng việc (việc, người, hạn, trạng thái, tin nguồn) + màn web | 22 | Xong 09/10 |
| Bot đề xuất việc từ tin nhắn, người giao / sếp xác nhận mới vào checklist | 22 | Xong 09/10 (chưa đo tỉ lệ bắt đúng trên tin thật) |
| Cập nhật bằng lệnh / câu tự nhiên («xong việc…», «dời hạn…») | 22 | Xong 09/10 |
| Nhắc người phụ trách 3 mốc: trước hạn 1 ngày, đúng hạn, quá hạn | 23 | Xong 09/10 |
| Quá hạn: báo người giao + sếp (trong trần báo / ngày) | 23 | Xong 09/10 |

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
| 5 | VIP | 5 | Một phần (chạy thật 08/10; chờ IDA gửi danh sách VIP) |
| 6 | Từ khóa KHẨN / QUAN TRỌNG | 5 | Đạt (08/10) |
| 7 | Đồng hồ chờ, giờ làm, giờ yên lặng | 3, 5 | Đạt (08/10) |
| 8 | Thế nào là «đã xử lý» | 3, 5 | Đạt (08/10) |
| 9 | Đẩy báo, trần 3 lần/ngày, báo phiên văng | 5 | Đạt (08/10) |
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
| 21 | Tìm tin + xem trước / sau | 6 | Đạt (09/10) |
| 22 | Checklist | 7 | Đạt (09/10) |
| 23 | Nhắc hạn | 7 | Đạt (09/10) |
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
| Khởi động lại MySQL trên VPS theo `command` mới trong docker-compose.yml (cấu hình tìm toàn văn, phase 6) — làm TRƯỚC khi deploy bản có migration 023 | Chưa — chưa làm thì tìm tin vẫn chạy nhưng chỉ quét LIKE 90 ngày; làm sau thì tin đã chép thiếu từ 1–2 chữ, phải chép lại (lệnh ở mục Phase 6, không khóa bảng) |
| Sau deploy phase 6: xem log worker «đã chép xong tin cũ vào bảng tìm»; kiểm chỗ trống ổ đĩa (bảng tìm chép lại chữ của mọi tin — chữ tin chiếm thêm ~gấp đôi) | Chưa |
| Lên VPS riêng 8 GB: nâng `mem_limit` + `innodb-buffer-pool-size` của MySQL (đang 768 MB / 256 MB, lúc nghỉ đã ~600–670 MB với 1 triệu tin); khi đó có thể nâng trần tìm toàn văn 32 MB → 64 MB và số câu tìm cùng lúc (`MAX_CONCURRENT_SEARCHES`) | Chưa |

Ước lượng cho một bot 100 nhóm ở mức «vừa» (20–100 tin / nhóm / ngày): 2.000–10.000 tin / ngày; 24 tháng
khoảng 1,5–7 triệu tin (2–7 GB database); ảnh / tệp giữ 6 tháng khoảng 10–55 GB — vì vậy tệp phải lên R2.

## 11. Đang chờ

| Ai | Việc |
|---|---|
| IDA | Link các bảng Google Drive thật (bản chép đang lỗi #REF!), chia sẻ quyền xem cho tài khoản dịch vụ của bot |
| IDA | 30–50 tin báo cáo thật kèm số đúng (bộ đo «trích đúng ≥ 95%») |
| IDA | Danh sách VIP; danh mục nhân viên và đại lý; file KPI; bộ tài liệu kỹ thuật và nhãn sản phẩm; form báo cáo tuần / tháng |
| Đại ca | Đổi khóa modelapi (đã lộ trong chat); nạp tiền khóa Gemini; bật Cloudflare Access; VPS riêng |
