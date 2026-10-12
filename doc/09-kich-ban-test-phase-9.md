# 09 — Kịch bản test tay phase 9 (Gửi tin theo lệnh, tắt bot khẩn, màn «Gửi tin»)

> Bản 2.0 · 12/10/2026 · thay bản 1.0 cùng ngày (câu chữ chưa khớp mã). Chạy trên prod với **2 tài khoản Zalo** + 1 buổi,
> dùng lại 3 nhóm TEST của [`08a-test-tay-phase-8-prod-2-tai-khoan.md`](08a-test-tay-phase-8-prod-2-tai-khoan.md). Căn cứ:
> [`06-lo-trinh.md`](06-lo-trinh.md) mục Phase 9, plan
> [`plans/261012-0854-phase-09-send-on-command/`](../plans/261012-0854-phase-09-send-on-command/plan.md) (mục «Quyết định
> đã chốt»), IDA câu 26. **Câu chữ mong đợi chép từ mã** (`src/send-commands/*`, `src/messaging/bot-halt-commands.ts`).
> Cột «KQ» ghi Đạt / Không đạt + chụp màn hình Zalo nếu không đạt.

## 0. Vai, nhóm, quy ước

| Ký hiệu | Là ai | Danh bạ | Người nhận | Web |
|---|---|---|---|---|
| **A** | Zalo chính của anh | Loại **Nhân sự**, vai trò **Quản lý** | **Mọi nhóm**, đang dùng | Quản trị |
| **B** | Zalo phụ | Loại **Nhân sự** (phase 8 để Khách hàng — đổi lại khi test phase 9), vai trò đổi theo **trạng thái B1 / B2 / B3** dưới | Hồ sơ B chọn **G1 + G3**, bật / tắt «Đang dùng» theo trạng thái | Quản lý, «Người trên Zalo» = B |

| Trạng thái B | Vai trò (Danh bạ) | Người nhận B «Đang dùng» | Quyền |
|---|---|---|---|
| **B1** | trống | TẮT | Không ra lệnh gửi, không tắt bot (người lạ) |
| **B2** | **Trưởng phòng** | TẮT | Ra lệnh gửi + tắt bot được; KHÔNG gửi nhóm Mật; KHÔNG bật lại bot |
| **B3** | Trưởng phòng | **BẬT** (G1 + G3) | Như B2 + gửi được G3 (đã chọn đúng nhóm) + bật lại bot |

Nhóm (bot + A + B, tạo ở test phase 8): **G1** `TEST Sales Miền Tây` (Nội bộ) · **G2** `TEST ĐL Thành Công` (**Khách
hàng**) · **G3** `TEST BGĐ Công nợ` (Nội bộ, **Mật**). Lệnh gửi chỉ nhận ở **tin riêng** với bot.

Quy ước: `<B>` = tên hiển thị của B trong Danh bạ; `G-<n>` = mã lệnh bot vừa trả (tăng dần). Sửa Danh bạ / Người nhận xong
**chờ ~1 phút** rồi mới gõ. Gửi ngay = bot gửi xong trong vài giây sau «đồng ý».

**Câu bot trả (chép từ mã):**

| Tình huống | Câu |
|---|---|
| Bản xem trước | `XEM TRƯỚC LỆNH GỬI G-<n>` / `Gửi tới <k> nơi:` / `1. Nhóm «…» (nội bộ)` hoặc `(nội bộ, Mật)` hoặc `1. Anh/chị <tên> (nhân sự)` / `Giờ gửi: ngay sau khi đồng ý` hoặc `Giờ gửi: HH:MM T2 12/10` / (`Lưu ý: …`) / (`Tệp kèm: <k> (tên tệp)`) / `Nội dung: «…»` / `Nhắn «đồng ý» trong 15 phút để gửi, «hủy» để bỏ.` |
| Đồng ý, gửi ngay | `Đã nhận lệnh G-<n>: <k> nơi, đang gửi. Gửi xong em báo kết quả.` |
| Đồng ý, hẹn giờ | `Đã nhận lệnh G-<n>: <k> nơi, sẽ gửi lúc HH:MM T2 12/10. Gửi xong em báo kết quả. Muốn hủy nhắn «hủy G-<n>».` |
| Báo kết quả | `KẾT QUẢ LỆNH G-<n>: <x>/<k> nơi thành công` + từng dòng `1. nhóm «…»: đã gửi` / `LỖI — <lý do>` (+ `Gửi lại nơi lỗi ở màn Gửi tin trên web.`) |
| Không quyền | `Lệnh gửi tin chỉ dành cho người nhận cảnh báo hoặc Quản lý / Trưởng phòng ạ.` |
| Gõ trong nhóm | `Anh/chị nhắn riêng cho em để ra lệnh gửi tin nhé — trong nhóm em không nhận lệnh gửi.` |
| Không thấy nơi nhận | `Em không thấy nơi nhận nào tên «…» (nhóm nội bộ hoặc nhân sự).` + `Em chưa tạo lệnh nào. Anh/chị nhắn lại giúp em.` |
| Nơi bị chặn | `Không gửi được tới «…»: <lý do>.` — lý do: `là nhóm khách — gửi từ màn Hội thoại trên web` · `là nhóm Mật — chỉ người nhận đã chọn đúng nhóm này mới gửi được` · `không phải nhân sự nội bộ — gửi từ màn Hội thoại trên web` |
| Quá 10 nơi | `Mỗi lệnh gửi tối đa 10 nơi (anh/chị nêu 11). Anh/chị chia làm hai lệnh giúp em.` |

## 1. Trước và ngay sau deploy

| # | Việc | Mong đợi | KQ |
|---|---|---|---|
| P-01 | Sao lưu CSDL prod; nếu bản deploy gồm cả phase 8 thì làm mục 1 của doc 08a trước | | |
| P-02 | Log khởi động app + worker | Đã chạy `028_send_commands.sql`, không lỗi. Service **worker** đang chạy (`docker compose ps`) — lệnh hẹn giờ + dọn nháp chạy ở worker | |
| P-03 | Cài đặt → Vận hành → danh sách việc nền | Có việc **send-command-watch** mỗi phút, lần chạy gần nhất không lỗi | |
| P-04 | Menu web của A (quản trị) | Có mục **«Gửi tin»**, danh sách trống; góc phải có nút **«Tắt bot»** | |
| P-05 | Danh bạ: A Nhân sự + Quản lý; B **Nhân sự**, vai trò trống. Người nhận B: tắt «Đang dùng» (→ **B1**). Người dùng: tài khoản web của B (Quản lý), «Người trên Zalo» = B | | |
| P-06 | A và B mỗi người nhắn riêng bot một câu (mở cuộc riêng — bot chỉ gửi được cho người đã có cuộc riêng / là bạn) | | |

## 2. Ra lệnh gửi (buổi sáng)

### 2.1 Quyền — B ở trạng thái B1

| # | Ai · ở đâu | Gõ (chép nguyên) | Mong đợi | KQ |
|---|---|---|---|---|
| Q-01 | B · riêng | `gửi nhóm TEST Sales Miền Tây: thử lệnh gửi của B1` | Câu «Không quyền». Không có lệnh nào ở màn Gửi tin | |
| Q-02 | B · riêng | `tắt bot` | Bot không làm gì (B1 là người lạ — không tắt, có thể trả lời như câu thường hoặc im). `tình trạng bot` của A vẫn ra «Bot đang BẬT, gửi tin bình thường.» | |

### 2.2 Luồng chính — A

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| S-01 | A · riêng | `hướng dẫn` | Có khối `GỬI TIN THEO LỆNH (nhóm / người nội bộ, tối đa 10 nơi, em cho xem trước rồi anh/chị nhắn «đồng ý» mới gửi):` + các dòng mẫu, dòng «tắt bot / bật bot / tình trạng bot» | |
| S-02 | A · riêng | `gửi nhóm TEST Sales Miền Tây: Sáng nay 10h họp giao ban Flowertop, các bạn chuẩn bị số liệu tuần trước nhé` | Bản xem trước **G-1**: `1. Nhóm «TEST Sales Miền Tây» (nội bộ)`, `Giờ gửi: ngay sau khi đồng ý`, `Nội dung: «Sáng nay 10h họp…»` đúng từng chữ. **Chưa** có tin nào trong G1 | |
| S-03 | A · riêng | `đồng ý` | `Đã nhận lệnh G-1: 1 nơi, đang gửi. Gửi xong em báo kết quả.` → G1 nhận đúng nội dung (dưới tên bot) → A nhận `KẾT QUẢ LỆNH G-1: 1/1 nơi thành công` / `1. nhóm «TEST Sales Miền Tây»: đã gửi` | |
| S-04 | A · riêng | `đồng ý G-1` (lần hai) | `Lệnh G-1 đã được xác nhận rồi (đã xong).` — G1 **không** nhận lần hai | |
| S-05 | A · riêng | `gửi nhóm TEST Sales Miền Tây, anh <B>: Nhắc cả nhà nộp báo cáo tồn kho trước 17h hôm nay` | Xem trước G-2 có **2 nơi**: `1. Nhóm «TEST Sales Miền Tây» (nội bộ)`, `2. Anh/chị <B> (nhân sự)` | |
| S-06 | A · riêng | `đồng ý G-2` | G1 + tin riêng của B nhận nội dung; báo `KẾT QUẢ LỆNH G-2: 2/2 nơi thành công` | |
| S-07 | A · web | Gửi tin → danh sách → mở G-2 | Dòng G-1, G-2: Nguồn «Lệnh Zalo», Người ra lệnh A, Số nơi, Đã gửi / lỗi, Trạng thái «Xong». Chi tiết G-2: bảng 2 nơi «Đã gửi», nội dung giữ xuống dòng | |

### 2.3 Hẹn giờ, hủy, nháp

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| H-01 | A · riêng | `gửi nhóm TEST Sales Miền Tây lúc 22h: Tin thử hẹn giờ yên lặng` | Xem trước G-3 có `Giờ gửi: 22:00 T2 12/10` + `Lưu ý: Giờ gửi rơi vào giờ yên lặng — người nhận có thể thấy tin muộn.` | |
| H-02 | A · riêng | `đồng ý` | `Đã nhận lệnh G-3: 1 nơi, sẽ gửi lúc 22:00 T2 12/10. Gửi xong em báo kết quả. Muốn hủy nhắn «hủy G-3».` | |
| H-03 | A · riêng | `lệnh gửi` | `LỆNH ĐANG HẸN (nhắn «hủy G-<số>» để hủy):` + `- G-3 · đang hẹn · 22:00 T2 12/10 · 1 nơi · «Tin thử hẹn giờ yên lặng»` + mục `GẦN ĐÂY:` | |
| H-04 | A · riêng | `hủy G-3` | `Đã hủy lệnh G-3.` — 22:00 G1 **không** nhận gì. Web: G-3 «Đã hủy» | |
| H-05 | A · riêng | `gửi nhóm TEST Sales Miền Tây chủ nhật lúc 9h: Tin thử ngày nghỉ` rồi `hủy` | Xem trước có `Lưu ý: Giờ gửi rơi vào ngày nghỉ — người nhận có thể thấy tin muộn.`; «hủy» trần bỏ nháp (không gửi gì) | |
| H-06 | A · riêng | `gửi nhóm TEST Sales Miền Tây: nháp thứ nhất` → (không đồng ý) → `gửi nhóm TEST Sales Miền Tây: nháp thứ hai` → `đồng ý G-<số của nháp thứ nhất>` | `Lệnh G-<…> đã quá hạn xác nhận — anh/chị nhắn lại lệnh gửi giúp em.` (mỗi người một nháp sống — nháp mới thay nháp cũ). Rồi `hủy` để bỏ nháp thứ hai | |
| H-07 | A · riêng | Tạo nháp `gửi nhóm TEST Sales Miền Tây: thử hết hạn`, chờ **16 phút**, rồi `đồng ý G-<số>` | `Lệnh G-<…> đã quá hạn xác nhận — anh/chị nhắn lại lệnh gửi giúp em.` Web: «Nháp hết hạn». G1 không nhận | |
| H-08 | A · riêng | `hủy G-1` | `Lệnh G-1 đã xong — không hủy được nữa.` | |

### 2.4 Tệp kèm

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| F-01 | A · riêng | Gửi bot 1 ảnh (vd ảnh trưng bày), rồi trong 10 phút gõ `gửi cái này vào nhóm TEST Sales Miền Tây: Ảnh trưng bày ĐL Tân Phú tuần này` | Xem trước có `Tệp kèm: 1 (<tên tệp>)` → `đồng ý` → G1 nhận chữ + ảnh, báo 1/1 thành công | |
| F-02 | A · riêng | Không gửi tệp (hoặc chờ quá 10 phút), gõ `gửi cái này vào nhóm TEST Sales Miền Tây: thử thiếu tệp` | `Em chưa thấy tệp / ảnh nào anh/chị vừa gửi em trong 10 phút qua. Anh/chị gửi tệp trước, rồi nhắn lại lệnh.` | |

### 2.5 Nơi nhận bị chặn / mơ hồ

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| T-01 | A · riêng | `gửi nhóm TEST ĐL Thành Công: thử nhóm khách` | `Không gửi được tới «nhóm TEST ĐL Thành Công»: là nhóm khách — gửi từ màn Hội thoại trên web.` + `Em chưa tạo lệnh nào…` | |
| T-02 | A · riêng | `gửi nhóm TEST BGĐ Công nợ: thử Mật từ người nhận mọi nhóm` | `Không gửi được tới «nhóm TEST BGĐ Công nợ»: là nhóm Mật — chỉ người nhận đã chọn đúng nhóm này mới gửi được.` («mọi nhóm» không tính) | |
| T-03 | A · riêng | `gửi nhóm Không Có Thật: thử` | `Em không thấy nơi nhận nào tên «nhóm Không Có Thật» (nhóm nội bộ hoặc nhân sự).` | |
| T-04 | A · riêng | `gửi a, b, c, d, e, f, g, h, i, k, l: thử 11 nơi` | `Mỗi lệnh gửi tối đa 10 nơi (anh/chị nêu 11). Anh/chị chia làm hai lệnh giúp em.` | |
| T-05 | A · web → Zalo | Danh bạ: đổi B sang **Khách hàng** → chờ 1 phút → A riêng `gửi anh <B>: thử người không phải nhân sự` → đổi B về **Nhân sự** | `Không gửi được tới «anh <B>»: không phải nhân sự nội bộ — gửi từ màn Hội thoại trên web.` | |
| T-06 | A · G1 | `@bot gửi nhóm TEST Sales Miền Tây: thử gõ trong nhóm` | `Anh/chị nhắn riêng cho em để ra lệnh gửi tin nhé — trong nhóm em không nhận lệnh gửi.` (không tạo lệnh) | |

### 2.6 Câu dài qua AI (quan sát)

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| AI-01 | A · riêng | `Em ơi nhắn giúp anh vào nhóm TEST Sales Miền Tây là chiều nay 15h họp giao ban nhé` | AI tạo nháp: trả **đúng khuôn** `XEM TRƯỚC LỆNH GỬI G-<n>` (máy chủ dựng, không phải AI tự viết); nội dung là đoạn **nguyên văn** trong câu (vd `chiều nay 15h họp giao ban nhé`). Chưa gửi gì cho tới khi gõ `đồng ý`. Nếu AI từ chối vì nội dung không nguyên văn → bot nhắc gõ theo mẫu «gửi nhóm A: <nội dung>» (đúng thiết kế, không tính lỗi). Xong thì `hủy` | |

## 3. B2 / B3 — quyền theo vai trò và nhóm Mật

| # | Ai · ở đâu | Gõ / làm | Mong đợi | KQ |
|---|---|---|---|---|
| R-01 | A · web | Danh bạ: B vai trò **Trưởng phòng** (→ **B2**), chờ 1 phút | | |
| R-02 | B · riêng | `gửi nhóm TEST Sales Miền Tây: Em B2 gửi thử` → `đồng ý` | Gửi được (có vai trò là đủ, không cần là người nhận) — báo 1/1 | |
| R-03 | B · riêng | `gửi nhóm TEST BGĐ Công nợ: thử Mật khi chỉ có vai trò` | `Không gửi được tới «nhóm TEST BGĐ Công nợ»: là nhóm Mật — chỉ người nhận đã chọn đúng nhóm này mới gửi được.` | |
| R-04 | B (web) | Đăng nhập web của B → «Gửi tin» | Chỉ thấy lệnh **của B** (R-02); không thấy G-1, G-2… của A. Không có nút «Tắt bot» / «Gửi lại nơi lỗi». Sửa URL thành `/app/send-commands/<mã G-1>` → báo không tìm thấy | |

*(Mục 4 tắt bot làm khi B còn ở B2, xong mới chuyển B3.)*

| # | Ai · ở đâu | Gõ / làm | Mong đợi | KQ |
|---|---|---|---|---|
| R-05 | A · web | Người nhận: bật «Đang dùng» hồ sơ B (G1 + G3) (→ **B3**), chờ 1 phút | | |
| R-06 | B · riêng | `gửi nhóm TEST BGĐ Công nợ: Biên bản đối chiếu ĐL Hòa Bình em gửi chiều nay` | Xem trước có `1. Nhóm «TEST BGĐ Công nợ» (nội bộ, Mật)` → `đồng ý` → G3 nhận, báo 1/1 | |
| R-07 | B · riêng | `gửi nhóm TEST: thử tên mơ hồ` | `«nhóm TEST» khớp 2 nơi:` / `1. nhóm «TEST Sales Miền Tây»` / `2. nhóm «TEST BGĐ Công nợ»` / `Anh/chị ghi rõ tên đầy đủ giúp em.` (G2 nhóm khách không được liệt kê). Không tạo lệnh | |

## 3b. Nhắc hẹn nhóm từ tin riêng + không báo «đã làm» khi chưa làm

> Sửa sự cố prod 12/10: nhắn riêng bảo tạo nhắc hẹn nhóm, bot nói đã tạo nhưng không tạo, còn tạo trùng 2 cuộc họp Meet.
> Plan: [`plans/261012-1042-dm-group-reminder-and-no-fake-actions/`](../plans/261012-1042-dm-group-reminder-and-no-fake-actions/plan.md).
> Đi qua AI (câu tự nhiên) — câu của bot có thể khác chữ, nhưng **bản xem trước / kết quả là khuôn cố định** do máy chủ dựng.

| # | Ai · ở đâu | Gõ | Mong đợi | KQ |
|---|---|---|---|---|
| N-01 | A · riêng | `Tạo nhắc hẹn họp giao ban lúc <giờ hiện tại + 10 phút> hôm nay trong nhóm TEST Sales Miền Tây` | Bot trả đúng khuôn: `XEM TRƯỚC NHẮC HẸN G-<n>` / `Tạo nhắc hẹn Zalo cho 1 nhóm:` / `1. Nhóm «TEST Sales Miền Tây» (nội bộ)` / `Nhắc lúc: HH:MM T2 12/10` / `Lặp: không lặp` / `Nội dung nhắc: «…»` / `Nhắn «đồng ý» trong 15 phút để tạo, «hủy» để bỏ.` — bot **không** nói «đã tạo»; nhóm chưa có nhắc hẹn | |
| N-02 | A · riêng | `đồng ý` | `Đã nhận lệnh G-<n>: tạo nhắc hẹn cho 1 nhóm. Tạo xong em báo kết quả.` → `KẾT QUẢ NHẮC HẸN G-<n>: 1/1 nhóm thành công` / `1. nhóm «TEST Sales Miền Tây»: đã tạo nhắc hẹn`. Trong G1 hiện **nhắc hẹn Zalo** (biểu tượng đồng hồ / mục Nhắc hẹn của nhóm), tới giờ Zalo tự báo cả nhóm | |
| N-03 | A · riêng | `đồng ý G-<n>` (lần hai) | `Lệnh G-<n> đã được xác nhận rồi (…)` — G1 **không** có nhắc hẹn thứ hai | |
| N-04 | A · riêng | `Nhắc hẹn cả nhóm TEST Sales Miền Tây 8h sáng thứ 2 hằng tuần: họp giao ban tuần` | Xem trước có `Lặp: hằng tuần`. Rồi `hủy` → không tạo | |
| N-05 | A · riêng | `Tạo nhắc hẹn 22h tối nay trong nhóm TEST Sales Miền Tây: chốt số liệu` | Xem trước có `Lưu ý: Giờ nhắc rơi vào giờ yên lặng.` Rồi `hủy` | |
| N-06 | A · riêng | `Tạo nhắc hẹn 9h sáng mai cho anh <B>: gọi khách Hòa Bình` | `«anh <B>» là một người, không phải nhóm — nhắc hẹn chỉ tạo cho nhóm.` + `Em chưa tạo lệnh nào…` (hoặc AI hỏi lại nhóm nào — không được nói đã tạo) | |
| N-07 | A · riêng | `Tạo nhắc hẹn 9h sáng mai trong nhóm TEST ĐL Thành Công: giao hàng đổi` | `Không tạo được nhắc hẹn cho «…TEST ĐL Thành Công»: là nhóm khách — nhắc hẹn từ tin riêng chỉ tạo cho nhóm nội bộ.` | |
| N-08 | A · riêng | `Tạo nhắc hẹn 9h sáng mai trong nhóm TEST BGĐ Công nợ: đối chiếu công nợ` | Bị chặn (A «mọi nhóm» không tính Mật). B ở **B3** gõ cùng câu → được xem trước `(nội bộ, Mật)` | |
| N-09 | A · riêng | `Ghim lên nhóm TEST Sales Miền Tây: giá Flowertop tuần này 450 nghìn` · `Tạo bình chọn trong nhóm TEST Sales Miền Tây: họp thứ 3 hay thứ 4?` | Bot nói rõ tin riêng không làm được, bảo **gọi bot trong nhóm đó**; **không** nói «đã ghim / đã tạo» | |
| N-10 | A · riêng | `Tạo cuộc họp Google Meet "Test chống trùng" lúc <giờ hiện tại + 1 giờ> hôm nay và tạo nhắc hẹn trong nhóm TEST Sales Miền Tây cùng giờ` | Câu trả lời có **dòng link Meet** (`https://meet.google.com/…`) ĐẶT TRÊN bản `XEM TRƯỚC NHẮC HẸN G-<n>`; `đồng ý` → nhắc hẹn tạo trong G1 | |
| N-11 | A · riêng | Gõ lại y hệt câu N-10 | Bot trả **cùng link Meet cũ** (không tạo cuộc họp thứ hai). Màn web / Google Calendar chỉ có 1 cuộc «Test chống trùng». Xong hủy: `hủy cuộc họp Test chống trùng` + `hủy` nháp nhắc hẹn | |
| N-12 | A · web | Gửi tin → lọc **Loại = Nhắc hẹn** → mở G-<n> của N-02 | Cột Loại «Nhắc hẹn»; chi tiết có «Nhắc lúc», «Lặp»; nơi G1 «Đã gửi» | |
| N-13 | A · riêng | `Tạo cuộc họp Google Meet "Test mời họp" lúc <giờ hiện tại + 1 giờ> hôm nay và gửi link lên nhóm TEST Sales Miền Tây` | Dòng `Đã tạo cuộc họp Google Meet … : https://meet.google.com/…` ĐẶT TRÊN bản `XEM TRƯỚC LỆNH GỬI G-<n>` có `Nội dung: «Mời họp: Test mời họp` / `Lúc: HH:MM T2 12/10` / `Link Google Meet: https://meet.google.com/…»` (nội dung do máy chủ dựng, đúng link vừa tạo). `đồng ý` → G1 nhận lời mời họp, báo 1/1. Bot **không** bảo «anh tự dán link» | |
| N-14 | A · riêng | (đã có cuộc họp ở N-13) `gửi link họp vừa tạo vào nhóm TEST BGĐ Công nợ` · rồi `em tự gửi vào nhóm TEST Sales Miền Tây cho anh` | Câu 1: bị chặn nhóm Mật (A «mọi nhóm»). Câu 2: bản xem trước lời mời của **đúng cuộc «Test mời họp»** (không tạo cuộc họp mới). `hủy` | |
| N-15 | A · riêng | `gửi link cuộc họp Không Có Thật vào nhóm TEST Sales Miền Tây` | «Em chưa thấy cuộc họp nào bot tạo (sắp tới hoặc đang diễn ra) khớp yêu cầu…» — không tạo lệnh. Xong hủy cuộc họp test: `hủy cuộc họp Test mời họp` | |

## 4. Tắt bot khẩn (B ở B2) — gửi lại nơi lỗi

> **Trên prod, lúc tắt bot KHÔNG tin nào ra cho bất kỳ ai** (cảnh báo khẩn, nhắc việc, bản tin, trả lời thật đều bỏ, không
> gửi bù). Làm nhanh (~10 phút), chọn lúc ít việc; nhớ bật lại ở K-10.

| # | Ai · ở đâu | Gõ / làm | Mong đợi | KQ |
|---|---|---|---|---|
| K-01 | A · riêng | `tình trạng bot` | `Bot đang BẬT, gửi tin bình thường.` | |
| K-02 | A · riêng | `gửi anh <B> lúc <giờ hiện tại + 3 phút>: Tin hẹn giờ trong lúc tắt bot` → `đồng ý` | `Đã nhận lệnh G-<h>: 1 nơi, sẽ gửi lúc …` (ghi lại G-<h>) | |
| K-03 | B · riêng | `tắt bot` (B2 có vai trò → tắt được) | `Đã TẮT bot lúc HH:MM — mọi tin gửi ra dừng ngay (trả lời, lệnh gửi, nhắc việc, cảnh báo, bản tin). Bot vẫn đọc + lưu tin. Người nhận nhắn «bật bot» để bật lại.` Web: dải đỏ «Bot đang TẮT KHẨN từ HH:MM 12/10 (bởi …) — không tin nào được gửi ra.» trên mọi trang | |
| K-04 | A · riêng | `tình trạng bot` | `Bot đang TẮT từ HH:MM … (bởi <B> …). Bot vẫn đọc và lưu tin; người nhận nhắn «bật bot» để bật lại.` | |
| K-05 | B · riêng | `tóm tắt nhóm TEST Sales Miền Tây hôm nay` rồi hỏi thêm một câu bất kỳ | Câu đầu: `Bot đang tạm dừng gửi tin từ HH:MM. Tin của anh/chị đã được lưu.`; câu sau: **im lặng** (một câu / người / lượt tắt) | |
| K-06 | A · G1 | `@bot hôm nay nhóm có gì mới?` | **Im lặng** (nhóm không bao giờ nhận câu «tạm dừng») | |
| K-07 | B · riêng | `bật bot` | `Chỉ người nhận cảnh báo hoặc quản trị web bật lại được.` — bot vẫn tắt | |
| K-08 | A · web | Hội thoại → mở cuộc riêng của B → gõ `thử gửi từ web lúc tắt` → Gửi | Báo lỗi `Bot đang tắt khẩn — bật lại ở màn Gửi tin.`; B **không** nhận gì | |
| K-09 | A · web | Chờ qua giờ hẹn của G-<h> **2–3 phút** → Gửi tin → mở G-<h> | Nơi B trạng thái **«Lỗi»**, lý do có chữ «tắt khẩn». B không nhận tin. (Không có tin báo kết quả trên Zalo — bot đang tắt) | |
| K-10 | A · riêng | `bật bot` | `Đã BẬT lại bot. Tin đến hạn trong lúc tắt đã bỏ, không gửi bù; lệnh gửi lỗi xem ở màn «Gửi tin».` Dải đỏ mất (≤ 30 giây). Nhật ký thao tác có «Tắt bot khẩn bởi <B> qua zalo…», «Bật lại bot bởi <A> qua zalo» | |
| K-11 | A · web | Gửi tin → G-<h> → **«Gửi lại nơi lỗi»** → xác nhận | Thông báo `Đã xếp gửi lại 1/1 nơi của lệnh G-<h>.` → B nhận tin; nơi B «Đã gửi», lệnh «Xong» | |
| K-12 | A · web | Gửi tin → nút **«Tắt bot»** → xác nhận đỏ → rồi **«Bật bot»** → xác nhận | Tắt / bật từ web chạy, dải đỏ hiện / mất; nhật ký thao tác ghi «qua web» | |
| K-13 | A | Trước khi tắt: tạo nhắc hẹn từ tin riêng (như N-01) nhưng **chưa** «đồng ý» → `tắt bot` (A) → `đồng ý` | Bot đang tắt: câu «tạm dừng» (hoặc im nếu đã nhận rồi); **không** có nhắc hẹn nào trong G1. Bật lại → nháp đã quá hạn hoặc nhắn lại lệnh | |

## 5. Theo dõi sau buổi test

```sql
-- Lệnh + nơi nhận hôm nay. status lệnh: 1 nháp · 2 đang hẹn · 3 đang gửi · 4 xong · 5 đã hủy · 6 hết hạn
-- status nơi: 1 chưa xếp · 2 chờ gửi · 3 đã gửi · 4 lỗi · 5 đã hủy
SELECT c.id, c.source, c.status, c.requester_name, c.scheduled_at, t.display_name, t.status, LEFT(t.error, 80)
FROM send_command c JOIN send_command_target t ON t.command_id = c.id
WHERE c.created_at >= CURDATE() ORDER BY c.id DESC, t.id;
-- Cờ tắt bot hiện tại (rỗng / halted:false = đang bật)
SELECT value, updated_at, updated_by FROM app_setting WHERE setting_key = 'bot_halt';
```

Cuối buổi: B về trạng thái anh muốn dùng tiếp (phase 8 cần B là **Khách hàng** cho câu hỏi của khách ở G2); kiểm `tình
trạng bot` = BẬT.

## 6. Đã biết, chưa làm (không tính lỗi)

- Hơn 8 nhóm trùng tên một cụm: bot chỉ liệt kê / xét 8 — có thể tự chọn một nhóm thay vì hỏi lại (bản xem trước vẫn ghi
  đúng tên nhóm sẽ gửi, xem kỹ trước khi «đồng ý»).
- Nơi nhận mà cuộc trò chuyện đã mất khỏi hệ thống bị đánh «đã gửi» dù không gửi gì.
- Lệnh 1 nơi lỗi hết vẫn hiện «Xong — có lỗi (1/1)» (chưa đổi thành «Lỗi»).
- Tin quản trị gửi từ màn Hội thoại cũng ghi vào «Gửi tin» (nguồn «Gửi từ web»), kể cả lần gửi lỗi; có tệp thì không gửi
  lại được.
- Nội dung phải nguyên văn có dấu: gõ không dấu mà AI tự thêm dấu → bot từ chối, nhờ gõ lại theo mẫu.
- «Gửi lại nơi lỗi» trên web không báo lại người ra lệnh trên Zalo. Gửi hàng loạt lớn / danh sách khách → giai đoạn 2.
- Ca phải tắt worker / sửa giờ (app chết quá 2 giờ sau giờ hẹn thì bỏ, trần 10 lệnh xác nhận / 20 nháp mỗi giờ) chỉ thử
  trên máy dev.

## 7. Rút lui nếu có sự cố

- Bot gửi bậy: gõ `tắt bot` (người có quyền) hoặc nút «Tắt bot» trên web — chặn mọi tin ra ngay, không cần deploy.
- Hủy hàng loạt lệnh đang hẹn: màn Gửi tin «Hủy lệnh» từng lệnh, hoặc
  `UPDATE job SET status = 4 WHERE kind = 6 AND status = 0;` (job gửi lệnh đang chờ → hết hạn).
- Migration 028 chỉ THÊM bảng — triển khai lại bản cũ là đủ, không cần xóa bảng.
