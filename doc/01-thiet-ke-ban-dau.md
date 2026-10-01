# Trợ lý Zalo cho IDA — thiết kế bản đầu

> Bản 0.3.1 · 01/10/2026: thêm `company` (nhiều công ty trong một bộ cài — nhóm gắn công ty, quản lý công ty
> nào chỉ thấy nhóm công ty đó; khách KHÁC thì bộ cài riêng) + `bot_group`; tin KHÔNG mã hóa (đại ca chốt).
> Bản 0.3 · 01/10/2026 · trạng thái: **đang làm** — đã có mã bản đồng bộ cơ bản (mục 7). Bản 0.3: chốt công nghệ, dựng mới
> (không dùng lại CRMzalo — bản beta đã bỏ), có giao diện quản trị tối thiểu.
> Bản 0.2: Bản 0.2 ghi 4 câu trả lời
> của đại ca ngày 01/10 (mục 11): VPS test trước · tài khoản Zalo nào cũng được · nhóm do IDA tự
> cài · nhiều người hỏi (trưởng phòng + quản lý).
> Nguồn yêu cầu: `CÁC NHU CẦU.xlsx` của IDA (7 nhu cầu, 180 tính năng). Bản đầu chỉ lấy
> phần lõi của N1 · N4 · N5 · N6 — xem mục 1.

## 0. Một câu

Một trợ lý **đọc các nhóm Zalo công việc** của IDA, **nhớ** những gì đã trao đổi, và trả lời
chủ khi được hỏi qua **Zalo hoặc Telegram**: tóm tắt nhóm, tóm tắt trao đổi với một nhân sự,
tra việc đã giao, tìm lại file.

## 1. Phạm vi

**Bản đầu làm đúng 4 việc:**

| # | Chủ hỏi | Bot trả lời | Mục trong file IDA |
|---|---|---|---|
| V1 | «Tóm tắt nhóm Bán hàng A, B hôm nay / tuần này» | tóm tắt theo nhóm: việc gì xảy ra, ai đang làm gì, vấn đề nổi lên, việc treo | TN004, TN005 |
| V2 | «Tuần này tôi đã bàn gì với chị A?» | tóm tắt tin A gửi, tin chủ trả lời A, tin nhắc tên A — trên mọi nhóm có A | TN004, TN138 |
| V3 | «Tuần trước tôi giao ai làm báo cáo bán hàng, tới hạn chưa?» | người giao · người nhận · việc · hạn · còn bao lâu / quá hạn · có ai báo xong chưa · link tin gốc | TN006, TN008, B21 |
| V4 | «Tìm file báo giá DL Thành Công» | danh sách file khớp: nhóm, người gửi, ngày, đoạn trích, tải về | B15, B16 |

**Chưa làm ở bản đầu:** đọc tin nhắn cá nhân (1-1) · bot gửi tin vào nhóm · gợi ý trả lời ·
gửi hàng loạt · mọi phần phân tích nghiệp vụ (doanh số, công nợ, tồn kho — cần ERP làm nền).

## 2. Người dùng và hai kênh ra lệnh

Người được hỏi bot (chốt 01/10): **quản lý + các trưởng phòng** của IDA. Mỗi người khai trong bảng
`app_user` (vai trò, Zalo uid, Telegram id). Ra lệnh qua **cả hai kênh**, cùng một bộ lệnh, cùng một
bộ não — hỏi ở kênh nào thì trả lời về kênh đó. «Tôi» trong câu hỏi (V2: «tuần này tôi đã bàn gì
với chị A») là chính người hỏi.

| Vai trò | Hỏi được về | Cấu hình nhóm |
|---|---|---|
| Quản lý | mọi nhóm đã bật đọc **của công ty mình** (quản trị chung: mọi công ty + nhóm chưa gán) | **có** — bật/tắt đọc tin, lấy file, thời hạn lưu |
| Trưởng phòng | chỉ các nhóm **chính họ là thành viên** trên Zalo | không |

Phạm vi của trưởng phòng đọc từ danh sách thành viên nhóm (bảng `member`), không khai tay: vào hay
rời nhóm trên Zalo là quyền tự đổi theo. Hỏi về một nhóm ngoài phạm vi thì bot trả lời như nhóm
không tồn tại.

**Lọc quyền trước khi đưa dữ liệu cho AI**: câu trả lời chỉ dựng từ tin của những nhóm người hỏi
được phép xem — không đưa hết vào rồi dặn AI «đừng nói».

**Cấu hình kênh** (bảng `channel_config`):

| Ô | Ý nghĩa |
|---|---|
| `enabled` | Bật / tắt từng kênh độc lập — Zalo bị khóa thì vẫn còn Telegram |
| (người được ra lệnh) | Lấy từ `app_user`, không khai ở đây. Người không có trong `app_user` nhắn vào thì **bỏ qua**, không trả lời |
| `notify` | Kênh nhận **thông báo chủ động** (bot được thêm vào nhóm mới, phiên Zalo bị văng, việc sắp tới hạn). Mặc định Telegram — vì chính lúc Zalo có sự cố là lúc cần báo |

Hai lý do có Telegram dù người dùng quen Zalo: (1) là **kênh dự phòng** khi tài khoản Zalo của bot
bị văng hoặc bị khóa; (2) là API **chính thức** nên không có rủi ro bị khóa.

## 3. Nguồn dữ liệu: chỉ các nhóm

- **1–2 tài khoản Zalo cá nhân của bot**, được thêm vào các nhóm công việc. Chốt 01/10: tài khoản
  nào đăng nhập được là dùng, không phân biệt IDA hay mình cấp. Vẫn **không nên** dùng tài khoản
  chính của một người đang làm việc — bị khóa là mất tài khoản đó.
- **Chỉ đọc nhóm.** Tin chủ nhắn riêng cho bot là **lệnh**, không đưa vào kho.
- Bản đầu bot **không gửi gì vào nhóm**.

**Cấu hình theo nhóm** (bảng `group_config`):

| Ô | Ý nghĩa | Mặc định |
|---|---|---|
| `read_messages` | Có lưu tin của nhóm không | **Tắt** |
| `capture_files` | Có tải file về kho không (tắt thì chỉ ghi tên file + thời điểm) | Tắt |
| `retention_days` | Giữ bao lâu | 730 (2 năm) |
| `label` | Tên gọi ngắn để hỏi («bán hàng A») | tên nhóm |

**Nhóm mới mặc định KHÔNG đọc**: ai cũng thêm được tài khoản bot vào một nhóm bất kỳ. Khi bị
thêm vào nhóm mới, bot nhắn **quản lý** qua kênh `notify`: *«Tôi vừa được thêm vào nhóm X (n thành viên)
— bật đọc tin? lấy file?»*, chủ bấm chọn.

## 4. Luồng dữ liệu

```
Zalo (tài khoản bot) ──> Cửa vào Zalo ──> Lưu tin (MySQL) ──> Gắn nhãn (Gemini Flash, theo lô)
                                   │                               ├─> bóc câu giao việc ─> bảng task
                                   │                               └─> đưa vào Meilisearch
                                   └─> nhóm có capture_files ─> tải NGAY về R2 ─> trích chữ ─> Meilisearch

Chủ (Zalo / Telegram) ──> Định tuyến lệnh ──> V1 tóm tắt nhóm · V2 tóm tắt theo người
                                             · V3 tra bảng task · V4 tìm file
```

- **File phải tải ngay lúc tin tới**: đường dẫn file của Zalo có thời hạn (thời hạn cụ thể phải
  đo thật ở P0). Để tới lúc có người hỏi mới tải là có thể đã hỏng.
- **Gắn nhãn theo lô** (vài chục tin một lần gọi) chứ không gọi AI từng tin — rẻ hơn nhiều lần.
  Nhãn: `giao_viec` · `hoi` · `bao_cao_so` · `thong_bao` · `thuong`.
- **Bóc việc**: tin có nhãn `giao_viec` được AI tách thành dòng `task` (người giao, người nhận,
  nội dung, hạn, tin gốc). Hạn không rõ thì để trống kèm cờ «thiếu hạn», **không tự đoán**. Tin
  sau đó kiểu «đã gửi báo cáo» được gắn làm dấu hiệu hoàn thành, có link tin làm bằng chứng.
- **Tóm tắt không đi qua vector**: lấy toàn bộ tin trong khoảng thời gian của nhóm rồi đưa cho AI.
  Nhóm quá đông thì tóm theo từng ngày rồi gộp.

## 5. Dữ liệu (sơ bộ)

`company` (công ty / pháp nhân trong bộ cài) · `bot_account` (tài khoản Zalo bot, trạng thái phiên) · `bot_group` (bot nào đang ở nhóm nào — nhiều bot cùng nhóm được) · `app_user` (người được hỏi, vai trò, công ty) · `channel_config` · `group` + `group_config` ·
`member` (uid Zalo → tên hiển thị) · `message` (nhóm, người gửi, thời điểm, nội dung, trả lời tin
nào, nhắc ai, nhãn) · `attachment` (khóa R2, tên, loại, chữ đã trích) · `task` · `command_log`
(ai hỏi gì, kênh nào, lúc nào, tốn bao nhiêu token).

Trạng thái / nhãn lưu **số + enum** chứ không lưu chữ tiếng Việt (cùng luật với ERP DEGO).

## 6. AI và chi phí

| Việc | Mô hình | Vì sao |
|---|---|---|
| Gắn nhãn, bóc việc, tóm tắt thường | **Gemini Flash / Flash-Lite** | rẻ, đủ tốt cho việc lặp lại |
| Tóm tắt rất dài, câu hỏi mơ hồ cần suy luận | **Claude** | chỉ khi thật cần, có trần theo ngày |

Ước lượng thô (giả định 20 nhóm × 300 tin/ngày, gắn nhãn theo lô): phần gắn nhãn cỡ vài triệu
token/tháng — **vài đô/tháng** với dòng Flash; mỗi lần tóm tắt một nhóm một ngày cỡ vài trăm đồng.
Con số phải đo lại bằng dữ liệu thật ở P4. **Trần chi phí theo ngày** cấu hình được; chạm trần thì
dừng gọi Claude và báo chủ.

**Trước khi gửi nội dung sang AI**: che số điện thoại, số tài khoản, CCCD (B36), trả về thì điền lại.

## 7. Hạ tầng

- **VPS riêng**, không dùng chung máy ERP DEGO (máy đó đã dùng 87% swap). Chốt 01/10: **mình làm,
  trước mắt chạy trên một VPS ngoài để thử**; khi IDA có VPS của họ (IDA tự trả phí) thì chuyển
  sang. Vì phải chuyển nhà nên mọi thứ chạy bằng Docker Compose + sao lưu/khôi phục bằng một lệnh.
  Bản đầu ước chừng 4 vCPU / 8 GB là đủ cho: ứng dụng, MySQL, Meilisearch, bước trích chữ; P0 chỉ cần
  2 vCPU / 4 GB.
- Chạy bằng Docker Compose; file trên **Cloudflare R2**; sao lưu MySQL hằng đêm lên R2.
- **Công nghệ (chốt 01/10):** dựng mới toàn bộ bằng **Node 22 + TypeScript**, dùng thẳng thư viện
  `zca-js` (ghim 2.2.0); **MySQL 8.4**; tệp lưu đĩa hoặc R2. Một tiến trình chạy mọi tài khoản bot +
  giao diện quản trị (HTML dựng phía máy chủ, không có frontend riêng). Không dùng lại CRMzalo — bản
  beta đã bỏ, và nó là CRM bán hàng đầy đủ, nặng hơn nhu cầu chỉ-đọc của IDA.
- **Giao diện quản trị tối thiểu:** đăng nhập QR tài khoản bot · bật/tắt đọc tin + lấy file từng nhóm ·
  danh sách tệp + tải về. Một mật khẩu quản trị (khóa 15 phút sau 5 lần sai), chỉ nghe ở 127.0.0.1.

## 8. Bảo mật và quyền riêng tư

- Chỉ `owner_ids` ra lệnh được; mọi lệnh ghi `command_log`.
- Bot này **không** có quyền sửa mã, **không** nối Google, **không** gửi tin ra ngoài ở bản đầu —
  giảm hẳn hậu quả nếu có ai tìm cách chèn lệnh qua nội dung tin nhắn.
- Nội dung tin nhắn là **dữ liệu, không phải lệnh**: bot không làm theo câu nào nằm trong tin nhóm.
- Tuân thủ NĐ 13/2023 và Luật Bảo vệ dữ liệu cá nhân 2025: thành viên nhóm được thông báo có trợ lý
  đọc nhóm (tài khoản bot đặt tên rõ ràng, ví dụ «Trợ lý AI IDA»); thời hạn lưu công bố rõ; IDA
  tự quyết và tự thông báo.

## 9. Rủi ro

| Rủi ro | Mức | Cách đỡ |
|---|---|---|
| **Zalo khóa tài khoản bot** (thư viện không chính thức) | Cao | SIM riêng, chủ yếu đọc, không gửi hàng loạt; tài khoản thứ hai dự phòng; Telegram vẫn chạy |
| Phiên đăng nhập bị văng | Trung bình | phát hiện trong vài phút, báo chủ qua Telegram kèm hướng dẫn quét QR lại |
| File Zalo hết hạn trước khi tải | Trung bình | tải ngay lúc tin tới; đo thời hạn thật ở P0 |
| Bóc việc sai (sai người nhận, sai hạn) | Trung bình | luôn kèm link tin gốc; hạn không rõ thì để trống, không đoán |
| Tìm kiếm tiếng Việt gõ không dấu | Thấp | lưu thêm bản bỏ dấu để tìm |

## 10. Chia phase

| Phase | Nội dung | Xong khi |
|---|---|---|
| **P0 — thử nền** | Thử thư viện Zalo trên tài khoản bot thật: đọc nhóm, nhận file, đo thời hạn link, đo độ ổn định phiên | đọc được tin + file của 1 nhóm thử liên tục 3 ngày |
| **P1 — lưu + hai kênh lệnh** | Kho tin, cấu hình nhóm/kênh, Telegram + Zalo nhận lệnh, bot hỏi chủ khi vào nhóm mới | chủ bật/tắt nhóm được qua cả hai kênh |
| **P2 — V1, V2, V4** | Tóm tắt nhóm, tóm tắt theo người, Meilisearch, tìm file | trả lời đúng trên nhóm thử |
| **P3 — V3** | Gắn nhãn, bóc việc, tra việc, nhắc việc sắp tới hạn | tra đúng việc đã giao tuần trước |
| **P4 — dùng thử thật** | IDA dùng 2–3 tuần trên vài nhóm thật; đo chi phí, độ đúng, tuổi thọ tài khoản | quyết định mở rộng hay đổi hướng |

**Tiêu chí nghiệm thu bản đầu (đo ở P4):** V3 tìm đúng việc đã giao ≥ 90% trên bộ 30 câu hỏi thật;
V1/V2 không nêu sai tên người; mọi câu trả lời có link về tin gốc; câu hỏi trả lời trong ≤ 10 giây.

## 11. Còn chờ quyết

**Đã chốt 01/10/2026:**

1. VPS: mình làm; trước mắt dùng một VPS ngoài để thử, sau chuyển sang VPS của IDA (IDA trả phí).
2. Tài khoản Zalo: tài khoản nào đăng nhập được là dùng, không phân biệt nguồn.
3. Nhóm: thử trên tài khoản test + nhóm test của mình; khi chạy thật IDA tự cài nhóm nào được đọc.
4. Người hỏi: trưởng phòng + quản lý, ngay từ bản đầu.

5. Trưởng phòng chỉ hỏi được nhóm mình có mặt; quản lý hỏi được mọi nhóm đã bật.
6. Chỉ quản lý bật/tắt đọc nhóm.
7. P0 code và chạy thử trên máy dev trước; đại ca thuê VPS 2 vCPU / 4 GB sau để chạy liên tục.
8. Khóa Gemini riêng cho dự án này (đại ca tạo), không dùng chung khóa ERP DEGO.

**Còn chờ:** tài khoản Zalo test cụ thể (đại ca quét QR lúc chạy P0) · VPS test · khóa Gemini.
