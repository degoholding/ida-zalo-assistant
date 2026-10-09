# 07 — Kịch bản test khi deploy phase 6 (Tìm tin) và phase 7 (Checklist công việc)

> Bản 1.0 · 09/10/2026 · commit `89203a2` (phase 6) + `0f6ad96` (phase 7). Căn cứ: [`06-lo-trinh.md`](06-lo-trinh.md) mục Phase 6, 7
> và sheet «Q&A làm rõ nhu cầu xây dựng IDA-Bot» (tab CÂU HỎI — câu 1, 4, 7, 9, 20–23; tab NHU CẦU — N4, N5; tab DANH MỤC
> VÍ DỤ — TN006–TN008, TN096–TN099, TN138, B13–B16, B21–B22; tab NKCV — từ ngữ, đại lý, việc hằng ngày của sale).
>
> **Cách dùng:** làm mục 1 trước khi deploy, mục 2 ngay sau deploy (kỹ thuật viên, ~30 phút), mục 3 với 2–3 người dùng
> thật trong một nhóm NỘI BỘ thử (vd «TEST bot IDA») trong 1–2 ngày làm việc, mục 5 theo dõi tuần đầu. Cột «KQ» ghi Đạt /
> Không đạt + ghi chú. Câu chữ ở mục 3 dựng theo đúng kiểu nhân viên IDA gõ (tab NKCV là nhật ký nhập tay, không phải tin
> Zalo thật) — tên người / đại lý là tên giả của chính sheet (Huy, Tâm, Minh, Tiến; ĐL Thành Công, Hòa Bình, Tân Phú, Phước Lộc).

## 0. Điểm phải chốt với IDA TRƯỚC nghiệm thu

| # | Đặc tả IDA | Bản đang chạy | Cần chốt |
|---|---|---|---|
| Q1 | Câu 23: «GĐ1 **chỉ nhắc chủ sở hữu** (trước hạn 1 ngày, đúng hạn, quá hạn). Nhắc trực tiếp người phụ trách chỉ khi chủ sở hữu ra lệnh /nhắc và xác nhận» | Nhắc 3 mốc **cho người phụ trách** (tag trong nhóm nội bộ, không thì nhắn riêng); quá hạn báo thêm người giao + sếp — đại ca chốt 09/10 | Giữ cách hiện tại hay đổi về «chỉ nhắc chủ sở hữu»? Nếu đổi: mốc 1–2 gửi sếp / người giao, bỏ tag người phụ trách |
| Q2 | Câu 22: «Việc nhân viên giao qua lại với nhau **chưa theo dõi** ở GĐ1» | AI bắt cả câu giao việc giữa nhân sự với nhau (đề xuất gửi người nói câu đó xác nhận) | Chỉ bắt câu của chủ sở hữu / sếp, hay giữ? |
| Q3 | Câu 9: tối đa 3 báo thường / ngày | Trần 3 lần / ngày áp cho **sếp** (nhắc tin chờ + việc quá hạn chung trần); nhắc người phụ trách không tính trần | Có cần trần cho nhắc người phụ trách không? |
| Q4 | NHU CẦU N4: «tìm được cả nội dung trong file PDF/Excel đã gửi»; B13 lọc `loai:file` | Trợ lý tìm được nội dung tệp đã đọc (`search_files`); màn «Tìm tin» CHỈ tìm chữ tin nhắn | Màn web có cần tìm cả nội dung tệp ở GĐ1? |
| Q5 | Đặc tả dùng mã việc «T012», lệnh /viec /xong /doihan /giao /task /nhac | Mã «V-12» («T-12» đã là ticket); nhận /viec /xong /doihan /giao; CHƯA có /task (thống kê) và /nhac (sếp ra lệnh nhắc) | Chấp nhận «V-»? Có làm /task, /nhac không? |

### Đối chiếu cú pháp lệnh (đưa cho người test)

| Đặc tả IDA (DANH MỤC B21, B22) | Gõ với bot (có dấu / không dấu đều được) |
|---|---|
| `/viec` | `/viec` · `việc` · `việc của tôi` · `việc nhóm` · `việc quá hạn` · `việc chờ xác nhận` |
| `/xong T012` | `/xong V-12` · `xong V-12 <ghi chú>` · `V-12 xong rồi` |
| `/doihan T012 05/10` | `/doihan V-12 05/10` · `dời V-12 sang thứ 2` · `gia hạn V-12 20/10` |
| `/giao @Tâm gửi báo giá DL Tân Phú 30/09` | `/giao Tâm: gửi báo giá ĐL Tân Phú hạn 30/09` (có dấu «:» sau tên). Không có «:» thì nói câu thường — trợ lý tự hiểu |
| (không có) | `giao lại V-12 cho Tiến` · `hủy V-12` · `mở lại V-12` · `V-12: <ghi chú>` · `V-12` (xem) · `ok V-12` / `bỏ V-12` (đề xuất) |
| `/tim gia han cong no 01/06-30/06` (TN138) | Màn web «Tìm tin»; hoặc hỏi trợ lý «tìm tin về gia hạn công nợ từ 1/6 tới 30/6» |

## 1. Chuẩn bị trước deploy (kỹ thuật)

| # | Việc | Cách kiểm | KQ |
|---|---|---|---|
| P-01 | Sao lưu CSDL mới nhất có trên R2 / `./backups` | `ls -lh backups/ \| tail -3` | |
| P-02 | Chỗ trống ổ đĩa ≥ 3 × dung lượng chữ tin (bảng tìm chép lại chữ của mọi tin + chỉ mục) | `SELECT ROUND(SUM(LENGTH(text))/1048576) AS mb FROM message;` so với `df -h` | |
| P-03 | Cập nhật `docker-compose.yml` mới rồi **khởi động lại MySQL TRƯỚC khi chạy app mới** | `docker compose up -d mysql` → `SELECT @@innodb_ft_min_token_size, @@innodb_ft_result_cache_limit, @@innodb_ft_enable_stopword;` = `1, 33554432, 0` | |
| P-04 | Phân loại nhóm: nhóm nào muốn bot TAG người phụ trách phải là «nội bộ» (mặc định là «khách hàng» → bot chỉ nhắn riêng) | Màn Nhóm, cột Loại; hoặc `SELECT id, name, group_kind FROM zalo_group WHERE thread_type = 1 AND read_messages = 1;` (2 = nội bộ) | |
| P-05 | Người nhận (sếp) đang bật + nhóm theo dõi đúng | Màn Người nhận | |
| P-06 | Nhóm thử nội bộ «TEST bot IDA»: bot + 2–3 nhân sự (1 người có vai trò Quản lý, 1–2 nhân viên «nhân sự»), bật «Đọc tin», loại «nội bộ» | Màn Nhóm, Danh bạ | |
| P-07 | AI bắt câu giao việc cần: Cài đặt → cảnh báo «AI xét tin» BẬT + màn Khóa AI có khóa chạy được | Màn Cài đặt / Khóa AI; log worker không có «chưa có khóa AI» | |

## 2. Kiểm nhanh ngay sau deploy (kỹ thuật, ~30 phút)

| # | Việc | Mong đợi | KQ |
|---|---|---|---|
| D-01 | Log khởi động app / worker | `Đã chạy: 023_message_fulltext.sql, 024_tasks.sql`; migration xong ngay (bảng mới, không khóa bảng `message`) | |
| D-02 | Bảng tìm chép tin cũ | Log worker `chép N tin cũ vào bảng tìm` … `đã chép xong tin cũ vào bảng tìm`; `SELECT backfill_next_id, backfilled_at FROM search_index_meta;` → `0`, có giờ. ~38.000 tin / giây | |
| D-03 | Màn Cài đặt → tab Vận hành: có 3 việc nền mới | «Chép tin cũ vào bảng tìm tin», «Nhắc hạn việc trong checklist», «AI bắt câu giao việc trong nhóm» — lần chạy gần nhất không lỗi | |
| D-04 | Menu trái | «Tìm tin» và «Việc» hiện với quản trị, quản lý, nhân viên; nhân viên không có nút «Tạo việc» / thao tác | |
| D-05 | Hàng đợi sạch | `SELECT status, COUNT(*) FROM job WHERE created_at > NOW() - INTERVAL 1 HOUR GROUP BY status;` — không có `3` (lỗi) tăng dần | |
| D-06 | MySQL không khởi động lại | `docker ps` cột STATUS của mysql «Up» đúng từ lúc P-03 (nếu «Up 2 minutes» bất thường → xem `docker compose logs mysql`, nghi hết RAM) | |
| D-07 | Ticket không bị ảnh hưởng | Nhắn bot «báo lỗi: test sau deploy» → có T-n; màn Ticket mở chi tiết thấy «Lịch sử thao tác» (trước đây lỗi 422) | |

### 2a. Phase 6 — Tìm tin (kỹ thuật)

| # | Thao tác | Mong đợi | KQ |
|---|---|---|---|
| S-01 | Màn «Tìm tin», chưa gõ gì | Bảng trống, câu gợi ý «Gõ từ khóa…» | |
| S-02 | Gõ `cong no` | Ra tin «công nợ», «Công Nợ»; chữ khớp tô sáng; mới nhất trước | |
| S-03 | Gõ `dai ly` | Khớp «đại lý» (đ = d) | |
| S-04 | Gõ `"gia han cong no"` (ngoặc kép) | Chỉ tin có đúng cụm theo thứ tự; tin có «công nợ … gia hạn» đảo thứ tự KHÔNG ra | |
| S-05 | Lọc Cuộc trò chuyện + Người gửi + «Lúc gửi» trong khoảng | Đúng phạm vi; chỉ chọn «Lúc gửi ≤ 31/08» vẫn ra tin (không rỗng) | |
| S-06 | Bấm «Xem trong hội thoại» | Mở màn Hội thoại đúng tin, thấy tin trước / sau (câu 21) | |
| S-07 | Tài khoản web nhân viên chỉ được 1 nhóm | Không thấy tin nhóm khác; nhóm đã tắt «Đọc tin» không ra | |
| S-08 | Gửi tin mới trong nhóm thử «test tìm tin xyz123» rồi tìm `xyz123` | Ra ngay (≤ vài giây) | |
| S-09 | Thu hồi tin vừa gửi trên Zalo, tìm lại | KHÔNG còn ra (câu 20) | |
| S-10 | Tìm từ rất phổ biến (`anh`, `ok`) | ≤ 5 giây; có thể có ghi chú «Từ khóa này phải dò từng tin nên chỉ tìm các tin từ …» / «Có hơn 1.000 tin khớp»; không báo lỗi; MySQL không khởi động lại (D-06) | |
| S-11 | Trợ lý (tin riêng): «ai nhắc tới hàng lỗi tháng này» | Liệt kê nhóm · người · giờ · đoạn trích; không ra tin nhóm Mật | |
| S-12 | Trong nhóm thử: «@bot tìm tin về xyz123» | Chỉ tìm trong nhóm đó | |
| S-13 | Gọi bot trong nhóm câu cần tra lâu (vd «@bot tóm tắt nhóm tuần này») | «Em nhận được rồi…» (nếu có) tới TRƯỚC câu trả lời, không bao giờ tới SAU | |

### 2b. Phase 7 — Checklist (kỹ thuật)

| # | Thao tác | Mong đợi | KQ |
|---|---|---|---|
| T-01 | Trong nhóm thử: «@bot giao Huy: gửi báo giá ĐL Tân Phú hạn thứ 6 17h» | Bot trả «Dạ đã ghi V-n … — hạn 17:00 T6 …; em đã báo Huy»; tin «@Huy có việc V-n…» có THẺ NHẮC thật (Huy nhận thông báo Zalo) | |
| T-02 | Cùng lệnh trong một nhóm KHÁCH HÀNG | Không có tin việc nào trong nhóm khách; Huy nhận tin riêng | |
| T-03 | Huy nhắn RIÊNG bot (Huy chưa có vai trò): «xong V-n đã gửi mail» | Bot «Dạ đã đánh xong V-n và báo …»; người giao được báo | |
| T-04 | Huy nhắn riêng «dời V-n mai» | Từ chối: «chỉ người giao việc hoặc quản lý» | |
| T-05 | Người giao: «/doihan V-n 20/10» rồi «giao lại V-n cho Tâm» | Hạn đổi; Huy được báo đã chuyển; Tâm được tag như việc mới | |
| T-06 | Khách hàng (Danh bạ loại khách) nhắn riêng bot «giao Huy: …» | «Chỉ nhân sự công ty mới giao việc qua bot được.» | |
| T-07 | Màn web «Việc»: tạo việc, xong, mở lại, dời hạn, giao lại, ghi chú | Người liên quan nhận tin Zalo; chi tiết có nhật ký + «Lịch sử thao tác» | |
| T-08 | Hai người cùng lúc: A bấm «Xong» trên web, B nhắn «hủy V-n» | Một người thành công; người sau nhận «V-n vừa được cập nhật» (không ghi đè) | |
| T-09 | **Nhắc quá hạn — chỉ máy THỬ (dev)**: `UPDATE task SET due_at = CURDATE() - INTERVAL 2 DAY, due_has_time = 0, remind_stage = 0, updated_at = NOW() - INTERVAL 3 DAY WHERE id = <n>;` trong giờ làm | ≤ 1 phút: tin «nhắc việc — có việc ĐÃ QUÁ HẠN» tag người phụ trách; người giao nhận «VIỆC ANH/CHỊ GIAO ĐÃ QUÁ HẠN»; sếp theo dõi nhóm nhận «VIỆC QUÁ HẠN» (nếu chưa hết 3 lần hôm đó). KHÔNG chạy trên prod (nhắn người thật) | |
| T-10 | Chạy lại T-09 cùng mốc | Không gửi lần hai | |
| T-11 | Tạo việc hạn trong quá khứ / gõ hạn vô lý (`1999-01-01`) | Hạn quá khứ: tạo được, KHÔNG bắn tin quá hạn ngay; hạn vô lý: bot hỏi lại hạn | |
| T-12 | Giờ yên lặng (sau 21:00 / Chủ nhật) | Không có tin nhắc; sáng ngày làm việc kế tiếp nhắc dồn | |

## 3. Tình huống dùng hằng ngày (người dùng thật, nhóm thử nội bộ)

> Vai trò: **TP** = trưởng phòng / quản lý (có vai trò trong Danh bạ, là người nhận); **TN** = trưởng nhóm KD; **Sale** =
> nhân viên kinh doanh (nhân sự, chưa có vai trò); **KT** = kế toán. «Riêng» = nhắn riêng bot; «Nhóm» = trong nhóm thử,
> có gọi bot (@bot / «bot ơi») trừ khi ghi «không gọi bot». TN, Sale, KT phải là «nhân sự» trong Danh bạ (khách / chưa phân
> loại thì bot không bắt câu giao việc, không cho giao việc).

### 3a. Checklist (N5 — câu 22, 23; TN006–TN008, B21–B22)

| # | Ai · ở đâu | Tin gõ | Mong đợi (bot hiện tại) | KQ |
|---|---|---|---|---|
| H-01 | TN · Nhóm, **không gọi bot** | `@Huy đối chiếu công nợ DL Thành Công trước thứ 5 nhé` | ≤ 5 phút (giờ làm): TN nhận tin riêng «Em thấy anh/chị vừa giao việc… V-n [nhóm] Huy — Đối chiếu công nợ ĐL Thành Công — hạn T5 …». TN trả `ok V-n` → Huy được tag trong nhóm (TN006). Xem Q2 | |
| H-02 | TP · Riêng | `giao Minh: thu công nợ ĐL Hòa Bình hạn thứ 6` | «Dạ đã ghi V-n … hạn T6 …; em đã báo Minh» (Minh nhận tin riêng vì đang hỏi trong tin riêng) | |
| H-03 | TP · Riêng | `/giao Tâm: gửi báo giá ĐL Tân Phú hạn 30/10` | Như H-02, hạn 30/10 (B22, thêm «:» và «hạn») | |
| H-04 | TP · Riêng | `giao Tâm gửi báo giá ĐL Tân Phú 30/10` (không «:») | Không phải lệnh gõ → trợ lý hiểu câu, gọi `create_task` → kết quả như H-03 | |
| H-05 | Sale · Nhóm, không gọi bot | `Chốt lại ngày nhận hàng 02/05. Do lịch xạ dời lại` | KHÔNG có đề xuất việc (báo tình hình, không giao ai) | |
| H-06 | TN · Nhóm, không gọi bot | `Tiến ghé ĐL Phước Lộc xử lí hàng lỗi center, đổi trả cho khách, xong báo a` | Đề xuất V-n cho Tiến, **chưa có hạn** → tin đề xuất ghi «hạn chưa có hạn»; sau khi ok, màn Việc lọc «Thiếu hạn» thấy việc này | |
| H-07 | TN · Nhóm, không gọi bot | `Cần kiểm tra lại đơn DH0925` | Không đề xuất (không chỉ ai) — hoặc đề xuất ghi «(chưa rõ người làm)»; KHÔNG được gán bừa cho ai (TN098) | |
| H-08 | TN · Nhóm, không gọi bot | `Huy làm giúp chị báo cáo công nợ` | Đề xuất V-n cho Huy, chưa có hạn (TN099 — hỏi lại hạn trong nhóm là GĐ2) | |
| H-09 | TP · Nhóm sau họp | Gửi tệp ghi âm họp → `@bot recap cuộc họp` (trong họp có: Huy thu công nợ ĐL Hòa Bình trong tuần; Minh lên kế hoạch hội thảo ĐL Tân Phú trước 15/10; Tâm kiểm kho cuối vụ ĐL Thành Công) | PDF recap + «Phân công» + câu hỏi «lưu các việc này vào checklist…?» → TP `có` → MỘT tin gộp tag Huy, Minh, Tâm; Minh hạn 15/10; «trong tuần» / «cuối vụ» có thể chưa thành hạn → bot liệt kê việc cần bổ sung hạn | |
| H-10 | TP · Nhóm | `@bot có` lần nữa sau H-09 | KHÔNG tạo trùng các việc đã lưu | |
| H-11 | Huy · Riêng | `/viec` | Danh sách việc của Huy (đang phụ trách), hạn gần trước, việc quá hạn có nhãn | |
| H-12 | Huy · Riêng | `xong V-n` | Đánh xong; TP / TN (người giao) được báo | |
| H-13 | Sale · Riêng | `dời V-n sang 20/10, đly chưa dọn kho kịp` | Từ chối nếu Sale không phải người giao (Sale báo người giao) — xem T-04 | |
| H-14 | TP · Riêng | `dời V-n sang 20/10, đly chưa dọn kho kịp` | Đổi hạn 20/10, người phụ trách được báo, nhắc tính lại từ đầu | |
| H-15 | TP · Riêng | `giao lại V-n cho Tiến` rồi `hủy V-m` | Tiến được tag; V-m hủy, không còn trong «việc quá hạn» | |
| H-16 | TP · Riêng | `giao Huy: gọi ĐL Thành Công chốt ngày nhận hàng hạn mai` (gõ thứ 7) | Hạn = Chủ nhật; KHÔNG nhắc «tới hạn hôm nay» ngày CN; sáng T2 08:30 nhắc QUÁ HẠN | |
| H-17 | Việc hạn **thứ 2** (để qua cuối tuần) | — | Nhắc «sắp tới hạn» **thứ 7 08:30** (T2–T7 là ngày làm việc), «tới hạn hôm nay» T2 08:30, quá hạn T3 08:30 (TN008) | |
| H-18 | TP · Riêng | `việc quá hạn` · `việc chờ xác nhận` | Danh sách đúng; đề xuất chưa ai xác nhận quá ~2 ngày làm việc tự biến mất | |
| H-19 | Huy · Nhóm (nói tự nhiên) | `@bot báo cáo công nợ anh giao em làm xong rồi nhé` | Trợ lý gọi `task_action done` đúng việc (hoặc hỏi lại nếu Huy có nhiều việc giống) | |
| H-20 | TP · Riêng | `/task` (thống kê, TN007) · `/nhac V-n` (câu 23) | CHƯA hỗ trợ → trợ lý trả lời theo câu thường. Ghi nhận cho Q5 | |

### 3b. Tìm tin (N4 — câu 20, 21; TN138, B13–B16)

| # | Ai · ở đâu | Tin gõ / thao tác | Mong đợi (bot hiện tại) | KQ |
|---|---|---|---|---|
| H-21 | TP · màn «Tìm tin» | `khat no` | Ra tin «khất nợ», tô sáng | |
| H-22 | TP · màn «Tìm tin» | `"gia han cong no"` + lọc nhóm «Sales Miền Tây» + Lúc gửi 01/06–30/06 | Đúng cụm, đúng nhóm, đúng khoảng ngày; mỗi dòng: nhóm · người · giờ · đoạn trích · «Xem trong hội thoại» (TN138, B16) | |
| H-23 | KT · màn «Tìm tin» | `hoa don` + Người gửi «Huy» | Tin về «biên bản điều chỉnh hóa đơn»; mở được hội thoại (B13 — không có lọc `loai:file`, xem Q4) | |
| H-24 | CEO · Riêng | `ai nhắc tới hàng lỗi centertaner tháng 4?` | Danh sách nhóm · người · giờ · đoạn trích; không ra tin nhóm Mật (câu 4) | |
| H-25 | TP · Riêng | `Huy nói gì về ĐL Thành Công tuần trước?` | Tìm theo người + từ khóa + khoảng ngày, trả lời có dẫn tin nguồn | |
| H-26 | Sale · Nhóm | `@bot tim tin ve pico lang day` | Ra tin «pico bị lắng đáy… thu hồi 4 chai» trong chính nhóm đó | |
| H-27 | TP · Riêng | `tìm tin về chiết khấu bị tính thuế TNCN` | Ra câu hỏi của đại lý về thuế trên chiết khấu | |
| H-28 | TP · màn «Tìm tin» | `Blaze`, `blaze`, `flowertop` | Không phân biệt hoa thường | |
| H-29 | TN · Riêng | `tồn kho ĐL Tân Phú còn bao nhiêu` | Trả các tin có nhắc tồn kho; KHÔNG tự bịa số (câu 12; số liệu tồn kho là GĐ2) | |
| H-30 | KT · Riêng | `tháng trước đại lý nào xin gia hạn công nợ?` | Tìm theo từ khóa: ra tin có «gia hạn công nợ»; tin chỉ ghi «cho em khất nợ tới 15» CÓ THỂ không ra — tìm theo nghĩa là GĐ2 (B14) | |

## 4. Ca biên / an toàn (kỹ thuật chạy, có thể gộp vào mục 2)

| # | Thao tác | Mong đợi | KQ |
|---|---|---|---|
| E-01 | Nhóm Mật: tìm từ khóa chắc chắn có trong nhóm Mật qua trợ lý | Không ra | |
| E-02 | Tìm `-hang*` / `"` lẻ / chuỗi emoji | Không lỗi; toán tử bị bỏ | |
| E-03 | Câu thường `ok v2`, `v3`, `Giao Hàng Nhanh: đơn 123 tới chưa` | KHÔNG bị hiểu là lệnh việc | |
| E-04 | `xong V-12 rồi nhé` | Ghi chú rỗng (không lưu «rồi nhé») | |
| E-05 | Giao việc hạn `5/1` vào cuối tháng 12 | Hạn = 05/01 năm SAU | |
| E-06 | Ghi chú `V-n: <nội dung>` liên tục 10 lần | Mỗi lần báo các bên (chưa có trần — ghi nhận, xem mục 6) | |

## 5. Theo dõi tuần đầu (kỹ thuật, mỗi sáng)

```sql
-- Việc theo nguồn + trạng thái (1 chờ xác nhận · 2 đang làm · 3 xong · 4 hủy; nguồn 1 lệnh · 2 trợ lý · 3 recap · 4 AI · 5 web)
SELECT source, status, COUNT(*) FROM task WHERE created_at > NOW() - INTERVAL 1 DAY GROUP BY source, status;
-- Đề xuất AI: ok / bỏ / tự hết hạn (sự kiện 2 xác nhận · 3 bỏ · 11 hết hạn) — tỉ lệ bắt đúng
SELECT kind, COUNT(*) FROM task_event e JOIN task t ON t.id = e.task_id
WHERE t.source = 4 AND e.kind IN (2, 3, 11) AND e.created_at > NOW() - INTERVAL 1 DAY GROUP BY kind;
-- Token AI của lượt bắt việc (so trần ngày ASSISTANT_DAILY_TOKEN_CAP)
SELECT purpose, SUM(input_tokens + output_tokens) AS tokens, COUNT(*) AS calls FROM system_ai_usage
WHERE created_at > NOW() - INTERVAL 1 DAY GROUP BY purpose;
-- Tin nhắc đã gửi / lỗi
SELECT status, COUNT(*) FROM job WHERE kind = 5 AND created_at > NOW() - INTERVAL 1 DAY GROUP BY status;
-- Bộ nhớ MySQL (nên < ~650 MB khi nghỉ với 768 MB)
-- docker stats --no-stream $(docker compose ps -q mysql)
```

Ngưỡng cần báo: tỉ lệ «bỏ + hết hạn» của đề xuất AI > 50 % (AI bắt sai nhiều → siết lọc / chỉ bắt câu của sếp — Q2);
token `task-extract` > 20 % trần ngày; job ContactMessage lỗi (status 3) > vài tin / ngày; MySQL khởi động lại.

## 6. Đã biết, chưa làm (không tính là lỗi khi test)

- Tìm theo nghĩa («khất nợ» ↔ «gia hạn công nợ») và tìm nội dung tệp trên màn «Tìm tin» — GĐ2 / Q4.
- /task (thống kê), /nhac (sếp ra lệnh nhắc người phụ trách) — Q5.
- Hỏi lại người giao «ai phụ trách / hạn khi nào?» ngay trong nhóm (TN098, TN099) — GĐ2; hiện ghi cờ thiếu người / thiếu hạn.
- Lệnh gõ có báo tin (ghi chú, xong…) chưa giới hạn số lần / người / giờ.
- Sếp chạm trần 3 lần / ngày thì việc quá hạn lượt đó không báo sếp (chưa có bản tin gom — phase 8).

## 7. Rút lui nếu có sự cố

- Migration 023, 024 chỉ THÊM bảng mới — triển khai lại bản cũ là đủ, bảng mới để nguyên không ảnh hưởng.
- MySQL hết RAM khi tìm: hạ `--innodb-ft-result-cache-limit` (vd 16777216) rồi khởi động lại MySQL — câu tìm từ phổ biến sẽ lùi
  về LIKE sớm hơn.
- Tắt riêng nhắc / bắt việc: chưa có công tắc trên màn Cài đặt — tạm thời triển khai lại bản trước, hoặc
  `UPDATE task SET remind_stage = 3 WHERE status = 2;` (ngừng mọi nhắc của việc hiện có).
