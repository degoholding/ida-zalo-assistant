# Bot trợ lý — mô tả chức năng và lộ trình

> Bản 1.0 · 02/10/2026 · mô tả đúng mã trên nhánh `dev1` sau commit gom ngày 02/10. Thiết kế gốc:
> [`01-thiet-ke-ban-dau.md`](01-thiet-ke-ban-dau.md) · đối chiếu đặc tả IDA (180 tính năng):
> [`02-doi-chieu-nhu-cau.md`](02-doi-chieu-nhu-cau.md). Tài liệu này trả lời hai câu: **bây giờ hệ thống
> làm được gì** (mục 1–6) và **làm gì tiếp theo, theo thứ tự nào** (mục 7).

## 0. Một đoạn

Một tài khoản Zalo («tài khoản bot») được thêm vào các nhóm công việc. Bot **lưu lại** tin, ảnh, tệp, thành
viên và sự kiện nhóm của những nhóm được bật đọc; **trả lời** người có vai trò khi họ nhắn riêng cho bot
bằng câu tự nhiên (tóm tắt nhóm, trao đổi với một người, tìm và đọc tệp…). Quản trị dùng giao diện web
`/app` để xem hội thoại, quản lý danh bạ / nhóm / công ty / tài khoản bot, nhắn thay bot, và nhập lịch sử cũ.

## 1. Đồng bộ Zalo

| Chức năng | Mô tả |
|---|---|
| Đăng nhập bằng QR | Màn Tài khoản bot → quét QR bằng Zalo trên điện thoại. Phiên lưu mã hóa (`SESSION_ENCRYPTION_KEY`), khởi động lại không phải quét. Phiên văng thì trạng thái chuyển «cần quét QR lại». |
| Nhiều tài khoản bot | Mỗi tài khoản một phiên Zalo riêng, chạy chung một máy chủ; một nhóm có nhiều bot thì tin chỉ lưu một lần. |
| Nhận diện nhóm | Lúc khởi động bot quét mọi nhóm mình đang ở, đồng bộ thành viên. Nhóm mới (bot được thêm vào) tự xuất hiện ở màn Nhóm. |
| Bật đọc từng nhóm | Mặc định **tắt**: nhóm chưa bật «Đọc tin» thì không lưu một chữ. «Lấy file» bật riêng. Thời hạn lưu từng nhóm (mặc định 730 ngày), quá hạn xóa cả tin lẫn tệp. |
| Lưu tin | Chữ, ảnh, tệp, video, ghi âm, sticker, link, vị trí, danh thiếp; trích dẫn (quote), nhắc tên (@mention). Tin bị thu hồi thì xóa chữ, giữ dấu vết. |
| Tin hệ thống | Sự kiện nhóm ghi thành một dòng giữa khung chat: vào nhóm, được thêm, rời nhóm, bị xóa / chặn, bổ nhiệm / gỡ phó nhóm, đổi tên, đổi ảnh nhóm, tạo link mời. |
| Tải tệp về kho | Tệp tải ngay lúc tin tới (link Zalo hết hạn nhanh), cất đĩa hoặc Cloudflare R2; lỗi thì thử lại, quá trần dung lượng thì bỏ. |
| Tin nhắn riêng | Người nhắn riêng cho bot được lưu thành một cuộc riêng; bot chỉ trả lời người có vai trò (mục 3). |
| Lấy tin cũ qua API | Nút «Lấy tin cũ» ở chi tiết nhóm (chạy nền, có tiến độ). **Zalo hiện trả rỗng** cho tin trước ngày bot vào nhóm (mục 6); nút giữ lại để bù tin lúc bot tắt. |

## 2. Giao diện quản trị (`/app`)

Khung giống ERP v2: màn danh sách có lọc nhanh, bộ lọc nâng cao, sắp xếp, phân trang, cột kéo / ghim / ẩn;
màn chi tiết có thẻ danh tính, biểu mẫu, các tab và «Lịch sử thao tác».

| Màn | Làm được gì |
|---|---|
| **Hội thoại** | Ba cột kiểu Zalo: danh sách cuộc (lọc Tất cả / Riêng / Nhóm, tìm), khung chat (ảnh hiện ngay trong khung, bấm phóng to; tin hệ thống là dòng xám giữa khung; ngăn ngày), thẻ hồ sơ bên phải (thành viên, vai trò, công ty). **Tin mới hiện tức thời** (SSE). Ô soạn: quản trị gõ chữ hoặc gửi tệp, đi ra Zalo **dưới tên bot**, lưu với nhãn «quản trị». |
| **Danh bạ** | Mọi người bot gặp (thành viên nhóm + người nhắn riêng): tên, ảnh, loại (khách hàng / nhân sự…), vai trò, công ty, thẻ, ghi chú. Gán vai trò ở đây là cấp quyền hỏi bot. |
| **Nhóm** | Danh sách nhóm bot đang ở, số tin, tin gần nhất; chi tiết: tên gọi, loại nhóm, công ty, bật «Đọc tin» / «Lấy file», thời hạn lưu, thành viên, nút «Lấy tin cũ». |
| **Tệp** | Mọi tệp / ảnh đã lưu: lọc theo cuộc, loại, trạng thái; tải về; xem **chữ đã bóc** (bot đọc tệp xong thì cất chữ để tìm và làm báo cáo); «Bóc chữ» thủ công; «Tải lại» tệp lỗi. |
| **Nhập lịch sử** | Lấy tin trước ngày bot vào nhóm từ Zalo Web — mục 5. |
| **Công ty** | Danh mục công ty; nhóm và người gắn công ty. |
| **Tài khoản bot** | Thêm bot bằng QR, bật / tắt, trạng thái phiên, số nhóm / số cuộc riêng. |

Mọi thao tác sửa qua web ghi vào bảng `audit_log`, hiện ở tab «Lịch sử thao tác» của từng bản ghi.

## 3. Trợ lý AI (nhắn riêng cho bot)

- **Ai hỏi được:** người được gán vai trò trong Danh bạ (quản lý, trưởng phòng). Người lạ nhắn vào: lưu
  tin, không trả lời. Bot **không tự trả lời trong nhóm**.
- **Cách hỏi:** câu tự nhiên, không dùng lệnh gạch chéo (đã chốt 02/10). Ví dụ: «tóm tắt nhóm K52 tuần
  này», «hôm qua anh Duy nói gì với em», «tìm file báo giá tháng 9», «đọc file vừa gửi rồi tóm tắt».
- **Xưng hô:** bot xưng «em», gọi «anh / chị».
- **Báo đã nhận:** câu trả lời chưa xong sau 2,5 giây thì bot nhắn trước «Dạ em nhận được rồi…».
- **Hỏi lại khi chưa rõ:** thiếu đối tượng (tệp nào, nhóm nào, ai) thì bot hỏi lại kèm danh sách để chọn,
  không đoán.
- **Công cụ bot tự gọi:**

| Công cụ | Việc |
|---|---|
| `list_groups` | danh sách nhóm đang đọc |
| `get_group_messages` | tin của một nhóm theo khoảng thời gian / người |
| `find_people` | tìm người theo tên |
| `get_conversation_with_person` | trao đổi với một người (riêng + trong nhóm) |
| `search_files` | tìm tệp theo tên **và nội dung đã bóc**; hỏi rỗng = tệp gần đây của người hỏi |
| `read_file` | đọc tệp: xlsx / docx / pdf / txt / csv / ảnh, tối đa 5 MB; chữ bóc ra được cất lại |
| `send_file` | gửi lại một tệp trong kho cho người hỏi |
| `web_search` | tìm trên mạng |

- **Mô hình:** Gemini bản nhẹ cho câu thường; tự chuyển bản mạnh (`GEMINI_MODEL_HEAVY`) khi ngữ cảnh dài
  (đọc tệp lớn, tóm tắt dài). Trần lượt hỏi / giờ và trần token / ngày cấu hình trong `.env`.

## 4. Dữ liệu và quy mô

- Bảng chính: `zalo_group` (nhóm và cuộc riêng), `message`, `attachment`, `attachment_text` (chữ bóc từ
  tệp, có FULLTEXT), `group_member`, `contact`, `company`, `bot_account`, `assistant_turn`, `audit_log`.
- Số tin và tin gần nhất của mỗi cuộc là **bộ đếm ghi sẵn** lúc lưu tin — màn danh sách không quét bảng
  `message`, chịu được nhiều nhóm nhiều tin.
- Loại tin lưu SMALLINT (`MessageKind` ở `src/constants.ts`, có `System = 9` cho tin hệ thống).

## 5. Nhập lịch sử từ Zalo Web

Đường **duy nhất** lấy được tin trước ngày bot vào nhóm (lý do ở mục 6).

1. Mở chat.zalo.me bằng **tài khoản cá nhân** của một thành viên lâu năm (không dùng tài khoản bot — mở
   web bằng tài khoản bot là bot bị đá, phải quét QR lại). Điện thoại hỏi đồng bộ thì đồng ý.
2. Kéo một trong ba nút ở màn Nhập lịch sử lên thanh dấu trang, rồi bấm khi đang ở Zalo Web:
   - **Xuất N nhóm của bot** — tự mở lần lượt các nhóm đang bật «Đọc tin»;
   - **Xuất toàn bộ danh sách** — mọi cuộc ở cột trái, cả nhóm lẫn chat riêng;
   - **Xuất cuộc đang mở** — chỉ cuộc đang mở.

   Trang tự mở từng cuộc, cuộn lên đầu, gom chữ + ảnh + tin hệ thống, mỗi cuộc tải về một tệp `.json`;
   góc phải dưới có bảng tiến độ và nút Dừng.
3. Quay lại màn Nhập lịch sử, chọn tất cả tệp một lượt. Kết quả cộng gộp: số tin mới, số tin được bổ sung
   ảnh / chữ, số trùng, tệp lỗi (nếu có).

Quy tắc khi nạp: chỉ nhập **nhóm bot đang ở và đã bật đọc**; tin trùng mã thì bỏ qua (nạp lại nhiều lần
không nhân đôi) nhưng **bổ sung** ảnh / chữ còn thiếu; tin hệ thống trùng câu chữ trong 90 giây coi là
trùng; giờ gửi lấy từ kho Zalo Web, không có thì suy từ `cliMsgId` (mốc giờ máy gửi); tệp chat riêng
**chưa nhập** (giữ làm bản lưu, chờ quyết — mục 8).

## 6. Giới hạn đã đo (không sửa được từ phía mình)

- **Tin cũ trước ngày bot vào nhóm:** API mây của Zalo trả `isFiltered` (đo 02/10/2026, chính Zalo Web cũng
  nhận câu đó); đồng bộ qua kết nối trực tiếp trả 0 tin; tệp «Xuất dữ liệu» của Zalo PC **mã hóa toàn bộ**;
  sao lưu điện thoại cũng mã hóa. Chỉ còn Zalo Web, và Zalo Web chỉ được điện thoại đồng bộ **khoảng 2 tuần**
  gần nhất. Kết luận: **thêm bot vào nhóm càng sớm càng tốt** — từ lúc đó trở đi không mất tin nào.
- Zalo Web chỉ liệt kê cuộc có tin trong cửa sổ 2 tuần; nhóm im lặng lâu hơn không xuất được.
- `zca-js` là thư viện **không chính thức**: tài khoản bot có rủi ro bị khóa; giữ giãn cách gửi
  (`ASSISTANT_SEND_INTERVAL_MS`) và không gửi hàng loạt.
- Ảnh từ Zalo Web lớn hơn 2 MB không xuất được (giới hạn của bookmarklet).

## 7. Lộ trình

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **A — Nền** | Đồng bộ Zalo đa tài khoản, lưu tin / tệp / thành viên, Danh bạ, trợ lý Gemini qua tin riêng, giao diện web khung ERP v2, gửi tin từ web, SSE, đọc tệp + cất chữ, nhật ký thao tác, bộ đếm, nhập lịch sử Zalo Web, tin hệ thống | **Xong** (dev1, 02/10/2026) |
| **B — Cài đặt + Google Sheets** ([plan thi công](04-plan-phase-b-cai-dat-google-sheets.md)) | Bảng `app_setting` + màn **Cài đặt**: khóa Gemini, mô hình nhẹ / nặng, giờ gửi bản tin, ngưỡng X giờ «chưa trả lời», giá trị mặc định nhóm — sửa trên web, không build lại; khóa bí mật mã hóa, không hiện lại nguyên văn. **Google Sheets** bằng service account (dán JSON vào Cài đặt, nút «Kiểm tra kết nối» ghi thử một dòng) | **Làm tiếp theo** (~1 ngày) |
| **C — Hạ tầng GĐ1** | Bộ lập lịch trong tiến trình; bảng cờ trên tin (`message_flag`: loại, ưu tiên, đã xử lý, ai xử lý); chủ sở hữu của mỗi bot; che SĐT / STK / CCCD trước khi gửi AI | chờ B |
| **D — Check tin nhắn (N1)** | @mention / hỏi thẳng chủ, VIP từ Danh bạ, phân loại Khẩn / Quan trọng / Thường, câu hỏi chưa trả lời quá X giờ, «có gì cần xử lý», đẩy tin khẩn | chờ C |
| **E — Tìm kiếm (N4)** | `search_messages` (từ khóa + người + nhóm + ngày + loại), màn tìm tin trên web, link về tin gốc | chờ C |
| **F — Checklist (N5)** | Bảng việc, bot đề xuất việc từ tin → chủ xác nhận, nhắc 3 mốc hạn | chờ C |
| **G — Bản tin & báo cáo (N6)** | Morning / End-of-day Brief đúng giờ, mẫu Executive Summary, mẫu tóm tắt tệp đủ mọi sheet, báo cáo theo mẫu, **xuất Excel / Google Sheets** | chờ B, C |
| **H — Gửi theo lệnh (N7)** | Câu lệnh tự nhiên → xem trước → xác nhận → gửi → báo kết quả; hẹn giờ; tắt bot khẩn | chờ C |
| **I — Thống kê (N3), Gợi ý trả lời (N2), nền tảng còn lại** | Trích số từ tin báo cáo, 2–3 bản nháp trả lời, khoanh quyền trưởng phòng theo nhóm, nhãn Mật, cảnh báo phiên văng, tài liệu PDPL | chờ D–H |

Ghi nhận để làm sau: Claude làm mô hình nặng (cần khóa API console, gói Max không dùng được); cache ngữ
cảnh Gemini cho tệp hỏi nhiều lần; bookmarklet tự quét theo lịch.

## 8. Còn chờ quyết

1. **Nhập chat riêng** của tài khoản người xuất (hộp thư cá nhân, tách khỏi tin của bot) — có cần không?
2. **Nhập nhóm bot không ở** (chỉ làm kho lưu, bot không đọc tiếp) — có cần không?
3. Các câu ở mục 4 của doc 02 còn mở: chủ sở hữu của bot, giờ làm việc + ngưỡng X giờ, giờ gửi bản tin, thời
   hạn lưu cho tài liệu PDPL, kênh dự phòng Telegram.
