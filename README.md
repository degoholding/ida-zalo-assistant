# bot-tro-ly

Bot trợ lý đọc các nhóm Zalo công việc. **Bản hiện tại: đồng bộ cơ bản + trợ lý AI** — tài khoản
bot đọc nhóm, lưu tin + thành viên nhóm, tải file ngay lúc tin tới, trả lời tin riêng bằng Gemini,
kèm giao diện web quản trị (`web/`, khung ERP v2) dưới `/app`: Hội thoại, Danh bạ, Nhóm, Tệp, Nhập lịch sử,
Công ty, Tài khoản bot (đăng nhập QR), Cài đặt (sửa cấu hình trên web + Google Sheets). Sự kiện nhóm (vào / rời / thêm người / đổi tên) lưu thành tin hệ thống. Màn Hội thoại nhận tin mới tức thời (kênh đẩy SSE `/api/events`) và có ô
soạn tin: quản trị gõ chữ / gửi tệp từ web, đi ra Zalo **dưới tên tài khoản bot**, lưu lại với nhãn «quản trị».

Tài liệu: **lộ trình + trạng thái từng việc** [`doc/06-lo-trinh.md`](doc/06-lo-trinh.md) · mô tả chức năng
[`doc/03-mo-ta-chuc-nang.md`](doc/03-mo-ta-chuc-nang.md) ·
đối chiếu đặc tả IDA [`doc/02-doi-chieu-nhu-cau.md`](doc/02-doi-chieu-nhu-cau.md) · plan phase 2 (Cài đặt +
Google Sheets) [`doc/04-plan-phase-b-cai-dat-google-sheets.md`](doc/04-plan-phase-b-cai-dat-google-sheets.md) · thiết kế gốc
[`doc/01-thiet-ke-ban-dau.md`](doc/01-thiet-ke-ban-dau.md) · đối chiếu yêu cầu IDA Global v0.2 với bot hiện tại (07/10/2026)
[`doc/05-doi-chieu-yeu-cau-ida-global.md`](doc/05-doi-chieu-yeu-cau-ida-global.md).

Công nghệ: Node 22 + TypeScript · `zca-js` 2.2.0 (thư viện Zalo **không chính thức**, ghim cứng) ·
MySQL 8.4 · tệp lưu đĩa hoặc Cloudflare R2.

## Nhánh và môi trường

| Nhánh | Môi trường | Ghi chú |
|---|---|---|
| `dev1` | local | Code hằng ngày ở đây |
| `dev` | dev | Gộp `dev1` → `dev` khi muốn thử trên máy dev |
| `main` | prod | Chỉ gộp từ `dev` sau khi đã chạy ổn trên dev |

Chiều gộp một chiều: `dev1` → `dev` → `main`. Vá gấp trên prod thì vá ở `main` rồi gộp ngược xuống `dev`, `dev1`.

## Chạy bằng Docker (cách chạy chính)

Máy chỉ cần Docker, không cần cài Node. Bốn container (08/10/2026): `app` (giữ phiên Zalo, nhận tin, trả lời,
giao diện), `worker` (việc nền theo lịch: dọn quá hạn, ảnh đại diện, hàng đợi, đưa sao lưu lên R2), `backup`
(mysqldump hằng ngày từ 02:00 vào `./backups`) và `mysql`. Migration tự chạy khi app / worker khởi động.

Bật kho tệp R2: đặt `STORAGE_DRIVER=r2` + `R2_*` (bucket, khóa đọc + ghi, `R2_PREFIX=bot-tro-ly/`) trong `.env`,
`docker compose up -d`, rồi chép tệp cũ đang nằm trên đĩa lên R2 (bot vẫn chạy trong lúc chép, tệp cũ vẫn đọc được):
`docker compose exec app node dist/cli.js storage-to-r2`.

```
cp .env.example .env
docker compose build
docker compose run --rm --no-deps app node dist/cli.js gen-key   # dán vào SESSION_ENCRYPTION_KEY
# điền tiếp MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD trong .env
docker compose up -d
docker compose exec app node dist/cli.js user-admin admin <mật khẩu>   # tài khoản quản trị đầu tiên
docker compose logs -f app
```

Giao diện: `http://127.0.0.1:8090` (chỉ mở trong máy; vào từ xa qua đường hầm SSH / Cloudflare Access).

1. **Công ty** → thêm các công ty con (mã + tên).
2. **Tài khoản bot** → nhập nhãn → *Lấy mã QR* → quét bằng app Zalo của tài khoản bot. Xong là bot chạy.
3. **Nhóm** → nhóm bot đang ở hiện ra, mặc định KHÔNG đọc → chọn công ty, tick *Đọc tin* / *Lấy file* → Lưu.
4. **Tệp** → tệp đã tải, tải về máy; tệp lỗi hoặc chưa lấy có nút *Tải vào kho*.
5. **Hội thoại** → xem tin từng nhóm và từng người nhắn riêng cho bot (cả câu bot trả lời).
6. **Danh bạ** → mọi người bot từng thấy (nhắn riêng + thành viên nhóm). Chọn vai trò **Quản lý** /
   **Trưởng phòng** cho ai thì bot trả lời tin riêng của người đó; để «Không» = chỉ lưu, không trả lời.

## Trợ lý AI (Gemini)

Đặt `GEMINI_API_KEY` trong `.env` (hoặc dán trên màn **Cài đặt**) là bật. Người có vai trò nhắn riêng cho bot, hỏi được:
tóm tắt nhóm theo thời gian · đã bàn gì với một người · tìm tệp và nhận tệp. Quyền hiện **mở hết**
(mọi vai trò hỏi được mọi nhóm). Mô hình chính `gemini-3.5-flash-lite` (đo 01/10/2026: 2–4 giây/câu);
quá tải hoặc hết hạn mức thì tự chuyển sang `GEMINI_FALLBACK_MODELS`. Mỗi lượt hỏi ghi ở bảng
`assistant_turn` (token, công cụ đã gọi, lỗi). Giới hạn: `ASSISTANT_MAX_PER_HOUR` câu/người/giờ,
`ASSISTANT_DAILY_TOKEN_CAP` token/ngày, bot gửi tin cách nhau `ASSISTANT_SEND_INTERVAL_MS`.

**Tìm web** (`web_search`, Google Search qua Gemini): bot tra giá thị trường, tin tức, quy định… kèm
nguồn. Gói miễn phí của Gemini KHÔNG có tìm web (đo 01/10/2026: 429) — bật thanh toán cho khóa thì chạy
ngay: 5.000 lượt tìm miễn phí/tháng, sau đó 14 USD/1.000 lượt (bảng giá Google 01/10/2026). Chưa bật thì
bot trả lời người hỏi là tìm web chưa bật.

**Chọn mô hình** (đo 03/10/2026 bằng khóa gói miễn phí, một câu hỏi tiếng Việt có gọi công cụ):

| Mô hình | Kết quả |
|---|---|
| `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` | ~1 giây, gọi công cụ đúng |
| `gemini-3.6-flash` | 2–3 giây, ổn định |
| `gemini-3.8-flash` | ~2,5 giây, có lần 503 quá tải |
| `gemini-3.5-flash` (mặc định việc nặng) | 11–12 giây — chậm |
| `gemma-4-26b-a4b-it` | ~3 giây |
| `gemini-2.5-*` | 404 — đã ngừng cho tài khoản mới |
| `gemini-3.1-pro-preview` | 429 ngay — gói miễn phí không có Pro |

Khóa miễn phí nên đặt: mô hình chính `gemini-3.5-flash-lite`, việc nặng `gemini-3.6-flash`, dự phòng
`gemini-3.1-flash-lite, gemini-3.8-flash, gemma-4-26b-a4b-it` — hạn mức miễn phí tính **riêng từng mô hình**
nên dự phòng toàn mô hình khác nhau thì một cái hết lượt vẫn còn cái khác. **Gói miễn phí: Google được dùng
nội dung gửi lên (tin nhắn, tệp) để cải thiện sản phẩm, người của Google có thể đọc** — chạy thật với dữ liệu
công ty thì bật thanh toán cho khóa.

**Gọi bot trong nhóm** (06/10/2026): tin nhóm @nhắc tên bot hoặc có từ khóa (Cài đặt → «Từ khóa gọi bot trong
nhóm», mặc định «bot», «bot ơi», «trợ lý ơi», «@bot»; khớp nguyên chữ ở bất kỳ chỗ nào trong tin) thì bot trả lời ngay trong nhóm, trích dẫn tin được hỏi — mọi thành viên gọi được (tắt «Trong nhóm: ai cũng gọi
được bot» thì chỉ người có vai trò; tin riêng luôn cần vai trò), chỉ nhóm đang «Đọc tin», trợ lý chỉ đọc dữ liệu của chính nhóm đó (`scopeGroupId` chặn trong
`src/assistant/tools.ts`). Trong nhóm bot còn **làm** được (06/10/2026): tạo nhắc hẹn Zalo, ghim nội dung (ghi chú có ghim), tạo bình chọn, bỏ ghim, hủy nhắc hẹn —
«bot nhắc cả nhóm 8h sáng mai nộp báo cáo», «bot ghim tóm tắt báo cáo tháng 8» (`src/assistant/group-action-tools.ts`;
việc gắn cứng vào nhóm đang hỏi, tối đa 3 việc / lần hỏi). Bấm «Trả lời» vào tin của bot cũng là gọi bot; bot đọc kèm ~10 tin gần nhất của nhóm (`src/assistant/group-context.ts`)
để hiểu câu hỏi nối tiếp. Mã: `src/zalo/group-trigger.ts` (nhận biết gọi bot), `src/zalo/group-assistant-replier.ts`.

**Hỏi trợ lý trên web** (màn «Hỏi trợ lý», `/app/assistant-chat`, 06/10/2026): chọn một người có vai trò rồi hỏi
như nhắn Zalo cho bot — đi đúng đường thật (cùng cài đặt, công cụ, giới hạn, nhật ký `assistant_turn`), không cần
Zalo. Mỗi người hỏi một cuộc «Hỏi trợ lý · <tên>» (mã `web-<uid>`) để trợ lý hiểu câu nối tiếp; cuộc này hiện ở
màn Hội thoại nhưng không gửi ra Zalo được (cuộc DEMO `demo-…` cũng vậy — chặn ở `SyncService.pickRunnerForThread`).
Báo cáo Excel hiện thành nút tải trong khung chat. API: `src/web/api/assistant-chat-api.ts`.

**Cuộc họp Google Meet + recap** (06/10/2026): «bot tạo cuộc họp google meet 9h mai» → sự kiện Google Calendar kèm link
Meet trên tài khoản đã **Kết nối Google** (Cài đặt → Google: tạo OAuth client loại «Web application», chép Client ID + Client
secret vào hai ô, bấm «Kết nối Google» — Gmail cá nhân được; app ở chế độ Testing thì 7 ngày kết nối lại một lần). Redirect URI:
`http://localhost:8090/api/google/oauth/callback` (mở trang quản trị bằng localhost — Google chỉ nhận http với
localhost). Callback không có cookie phiên → chống giả mạo bằng `state` một lần. Refresh token lưu mã hóa ở khóa ẩn
`google_calendar_account`. Recap họp: gửi file ghi âm vào nhóm, «bot recap cuộc họp» → TÓM TẮT / QUYẾT ĐỊNH / PHÂN
CÔNG (người — việc — hạn) / GỠ BĂNG; tệp > 14 MB tải lên Gemini Files API (đo: WAV 21,6 MB ~2 phút họp → 33 giây).
Gmail miễn phí không có transcript Meet nên recap tự động từ Meet cần Google Workspace (chưa làm). Mã:
`src/google/google-oauth.ts`, `calendar-meetings.ts`, `src/assistant/meeting-tool.ts`, `gemini-files.ts`.

**Recap họp ra PDF** (06/10/2026): đọc ghi âm xong bot gọi `create_meeting_recap_pdf` → PDF theo mẫu «Meeting Recap» của
DEGO (logo, bảng thông tin, TL;DR, các phần, định hướng, công việc người / hạn / ưu tiên, mốc thời gian, vấn đề mở) gửi vào
nhóm (hoặc tin riêng). Câu trả lời trên Zalo: TL;DR + phân công theo người với «@Tên» — bot đổi thành thẻ nhắc Zalo thật cho
thành viên khớp tên — rồi hỏi «có muốn em nhắc các việc này hằng ngày không»; đồng ý → một nhắc hẹn lặp hằng ngày. Dựng bằng
pdfmake (JS thuần) + font Be Vietnam Pro / Noto Symbols trong `assets/` (Dockerfile chép `assets`). Mã: `src/reports/meeting-recap-*.ts`,
`pdf-text-runs.ts`, `src/assistant/meeting-recap-tool.ts`, `src/zalo/group-mentions.ts`.

**Đọc link** (07/10/2026): «bot đọc link của X rồi recap» → công cụ `read_link` tải link Google Sheets (xuất xlsx — mọi sheet),
Docs / Slides (xuất txt), tệp Drive, hoặc trang web (lấy chữ HTML). Link Google chỉ cần chia sẻ «Bất kỳ ai có đường liên kết».
Chỉ đọc link đã có trong tin nhắn / câu hỏi (chống mô hình bị dụ nhét dữ liệu vào đường dẫn); chặn địa chỉ nội bộ ở mọi bước
chuyển hướng. Tóm tắt tài liệu: đủ mọi phần, mỗi phần 2–4 ý có số, nhận xét gom cuối. Mã: `src/assistant/link-reader.ts`,
`read-link-tool.ts`. Đọc xong muốn «xuất file» → `create_summary_pdf` (PDF «Tóm tắt tài liệu», cùng khung mẫu recap họp, biến
thể `document` trong `meeting-recap-input.ts`) hoặc `export_report` (Excel / Sheets — mở cho cả hỏi trong nhóm).

**Quy trình báo cáo** (07/10/2026): câu hỏi có «báo cáo / tổng hợp / thống kê / xuất file / Excel / PDF / recap»
(`isReportRequest`) → chạy mô hình VIỆC NẶNG ngay từ đầu, tối đa 10 vòng gọi công cụ, prompt gắn thêm quy trình 4 bước (chốt phạm
vi → lấy đủ dữ liệu → tự kiểm số → khung chuẩn: tóm tắt có số / chi tiết có cột Nguồn / bất thường / việc cần làm) kèm 1 ví dụ
mẫu. `export_report` có `period` + `extra_sheets` (tab phụ), tên tệp theo quy ước IDA «Tên công việc - Thời gian - Tên nhân
viên». Mã: `src/assistant/report-playbook.ts`, `src/reports/report-table.ts`.

**Gemini hoặc OpenAI** (07/10/2026): Cài đặt → «Nhà cung cấp AI»: `gemini` · `openai` (tắt Gemini) · `openai_then_gemini`
(trả lời bằng GPT, OpenAI lỗi bất kỳ — khóa sai, hết tiền, quá tải — thì làm lại lượt đó bằng Gemini và nghỉ OpenAI 10 phút).
Mỗi bên một bộ mô hình (chính / việc nặng / dự phòng): OpenAI mặc định `gpt-6-luna` / `gpt-6.1-sol`. «Địa chỉ API OpenAI» cho
khóa mua qua bên bán lại. Chỉ OpenAI: không tìm web, ghi âm gỡ băng qua `/audio/transcriptions` (tối đa 25 MB). Khóa «sk-…»
dán nhầm vào ô Gemini được hiểu là khóa OpenAI; lỗi OpenAI ghi log đã che khóa. Mã: `src/assistant/openai-client.ts` (SDK
chính thức `openai`), `model-router-client.ts`.

**Khóa AI** (07/10/2026, tab đầu của Cài đặt — thay ~19 ô AI rời): danh sách khóa có thứ tự 1, 2, 3… (Gemini · OpenAI · DeepSeek ·
Grok · OpenRouter · «Tương thích OpenAI (tùy chỉnh)» với địa chỉ trạm riêng). Bot dùng khóa số 1; khóa đó hết tiền (402), hết hạn
mức (429), sai / hết quyền (401/403), quá tải (5xx), quá thời gian hay lỗi bất kỳ thì làm lại lượt đó bằng khóa kế, im lặng — khóa
lỗi xuống cuối hàng 10 phút, màn hình hiện «Lỗi lúc hh:mm: hết tiền (402)». Trần lượt / ngày (giờ Việt Nam) từng khóa, chạm trần thì
nhảy khóa kế. Thêm khóa: máy chủ gọi thử hãng (liệt kê mô hình, không tốn token) rồi mới lưu mã hóa; trạm chỉ nhận https + tên miền
công khai (chặn localhost / IP nội bộ, kể cả tên miền trỏ về IP nội bộ). Bảng `ai_key` rỗng = chạy bằng cài đặt cũ như trước; khởi
động lần đầu với bảng chưa từng có dòng thì tự chép khóa từ cài đặt cũ theo đúng thứ tự đang dùng. Có khóa thì các ô AI cũ của tab
«Trợ lý AI» gập vào «Nâng cao (cách cũ)». Mã: `src/assistant/key-chain-client.ts`, `ai-key-store.ts`, `ai-key-providers.ts`,
`src/web/api/ai-keys-api.ts`, migration `015_ai_key.sql`.

**Đo token** (06/10/2026): bật Cài đặt → «Hiện số token dưới câu trả lời» thì mỗi câu trả lời kèm tổng token làm tròn
nghìn «[3k token]» — mặc định TẮT. `src/assistant/token-usage-footer.ts`; dòng này bị bỏ khi đưa lịch sử cho mô hình.

**Báo cáo ra file** (`export_report`, 05/10/2026): người hỏi nói «xuất báo cáo … ra Excel / Google Sheets / file»
thì trợ lý lấy dữ liệu, soạn thành một bảng rồi xuất. Google Sheets đã kết nối (màn Cài đặt) → mỗi báo cáo một
tab mới trên trang tính, bot gửi link mở thẳng tab; chưa kết nối, hoặc người hỏi nói «Excel» → tệp `.xlsx` cất
kho (`reports/<yyyymm>/…`), bot gửi tệp qua Zalo, màn Tệp tải lại được. Sheets lỗi (chưa chia sẻ, hết hạn mức…)
thì tự lùi về Excel. Một lượt hỏi một báo cáo, tối đa 20 cột × 1.000 dòng. Mã: `src/reports/`,
`src/assistant/export-report-tool.ts`. Thử trên máy dev: `npm run ask -- "xuất file Excel báo cáo các nhóm 3 ngày qua"`.
Báo cáo có số liệu tiền thì đối chiếu tin gốc — mô hình có lúc ghi nhầm giá trước / sau giảm.

## Cài đặt trên web + Google Sheets

Màn **Cài đặt** (`/app/settings`) sửa khóa Gemini, mô hình, các trần của trợ lý, giãn cách gửi, mặc định
nhóm / cuộc riêng mới, cỡ tệp tối đa — lưu là **có hiệu lực ngay**, không khởi động lại. Thứ tự ưu tiên:
giá trị trên web (bảng `app_setting`) > `.env` > mặc định trong mã; «Khôi phục mặc định» = xóa giá trị web,
quay về `.env`. Danh mục khóa khai một chỗ ở `src/settings/setting-registry.ts`. Khóa bí mật (khóa Gemini,
khóa service account) lưu mã hóa bằng `SESSION_ENCRYPTION_KEY`, API chỉ trả «đã đặt» + 4 ký tự cuối / email.
Những thứ cần có trước khi vào được web (`DATABASE_URL`, khóa mã hóa, cổng, nơi cất tệp…)
vẫn chỉ đặt ở `.env`.

**Google Sheets** (service account, không cần đăng nhập Google):

1. Vào https://console.cloud.google.com → chọn / tạo project (vd `bot-tro-ly`).
2. **APIs & Services → Library** → tìm **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** → đặt tên (vd `bot-tro-ly-sheets`) → bỏ qua
   phần cấp quyền → Done.
4. Mở service account vừa tạo → tab **Keys → Add key → Create new key → JSON** → tệp `.json` tự tải về.
   **Không gửi tệp này qua Zalo / email**; mở bằng Notepad, chép toàn bộ, dán vào ô «Khóa service account».
5. Mở Google Sheet muốn bot ghi vào → **Chia sẻ** → dán email service account (màn Cài đặt hiện sẵn sau khi
   dán khóa) → quyền **Người chỉnh sửa** → bỏ tick «Thông báo» → Chia sẻ. Chép link trang tính dán vào ô
   «Link trang tính», lưu, bấm **Kiểm tra kết nối** → có dòng mới trong tab «Bot trợ lý».

## Cảnh báo tin nhắn (phase 5)

Mã ở `src/alerts/`. Mỗi tin mới trong nhóm (đang đọc) được phân loại ngay trong tiến trình `app`:

- **Từ khóa** (`keyword-matcher.ts`): tin có dấu so ĐÚNG dấu, nguyên chữ («gặp» không khớp «gấp»); tin gõ không dấu
  chỉ tin cụm nhiều chữ. Từ «nghiêm» (`alert_strict_keywords`, mặc định «la, liền, ngay») và từ khẩn một chữ trong
  tin không dấu không báo ngay — chờ **AI xét theo lô** (`ai-review.ts`, 5 phút / lần ở `worker`, một lần gọi cho
  cả lô, nhóm Mật không gửi, chữ đã che SĐT / STK / CCCD, token ghi bảng `system_ai_usage` và tính vào trần ngày).
- **Người nhận** (màn Người nhận): chỉ nhận báo của nhóm mình theo dõi. Tin KHẨN hoặc tin của VIP riêng người đó →
  việc `AlertDispatch` trên hàng đợi, gộp các tin trong `alert_urgent_merge_seconds` thành một tin Zalo.
- **Đồng hồ chờ**: tin @nhắc / trả lời đúng người nhận, câu hỏi của khách trong nhóm khách hàng → hạn = N phút
  LÀM VIỆC (lịch ở thẻ «Giờ làm việc»). Đóng khi có người trích dẫn trả lời, nhắc tên người hỏi, hoặc người nhận
  nhắn bot «xong tin …». Quá hạn → `worker` nhắc (1 phút / lần), tối đa `alert_daily_reminder_cap` lần / ngày,
  không nhắc trong giờ yên lặng. Bảng `alert_log` giữ «đã báo gì cho ai» để không báo trùng.
- **Phiên Zalo văng** (`session-watch.ts`): quá 5 phút không có nhịp tim hoặc phải đăng nhập lại → báo qua
  **Telegram** (`alert_telegram_bot_token` + `alert_telegram_chat_id`), một lần khi văng, một lần khi nối lại.
- **Qua chat riêng với bot** (`src/assistant/alert-tools.ts`): «có gì cần xử lý», «xong tin …»; Quản lý / Trưởng
  phòng đổi từ khóa và số phút chờ, người nhận đổi VIP / giờ bản tin của mình. Mọi thay đổi: bot đưa bản xem trước,
  phải xác nhận ở **tin sau** mới lưu; ghi «Lịch sử thao tác» với tên người đổi «(qua Zalo)».
- **Lệnh gõ sẵn** (`src/assistant/chat-commands.ts`, chạy TRƯỚC mô hình — trả lời ngay, không tốn token, chạy cả khi chạm
  trần ngày): «hướng dẫn» (nội dung theo vai trò; trong nhóm ra bản ngắn), «cấu hình», «cần xử lý», «xong <số>»,
  «thêm / bỏ từ khẩn <từ>», «thêm / bỏ từ quan trọng <từ>», «phút chờ <n>», «phút chờ vip <n>», «thêm / bỏ vip <tên>»,
  rồi «đồng ý» / «hủy». Gõ có dấu hay không dấu đều nhận; «ok» / «không» chỉ là lệnh khi đang có đề xuất chờ.

## Ticket qua bot (phase 11)

Mã ở `src/tickets/` (một chỗ cho mọi thao tác — lệnh Zalo và màn Ticket trên web cùng gọi). Nhân viên nhắn bot
«báo lỗi: <nội dung>» (tin riêng hoặc gọi bot trong nhóm); ảnh / tệp người đó gửi trong 15 phút trước tự gắn vào ticket
(nhóm chưa bật lấy tệp thì đưa lại hàng tải). Bot báo những người trong bảng `ticket_handler` (sửa ở màn Ticket, chỉ quản
trị) qua việc `ContactMessage` trên hàng đợi — chữ ngay, ảnh sau 30 giây cho kịp tải về kho. Người xử lý gõ «nhận T-12»,
«xong T-12 <ghi chú>», «T-12: <nhắn người gửi>», «ticket»; người gửi gõ «T-12», «T-12: <bổ sung>» (ticket đã xong thì mở
lại), «hủy T-12», «ticket». Bot báo lại người gửi vào đúng cuộc họ đã báo. Nhân viên chưa có vai trò vẫn dùng được các
lệnh ticket + «hướng dẫn» trong tin riêng (khách hàng thì không); câu hỏi khác của họ vẫn không được trả lời.

## Xem cơ sở dữ liệu bằng Adminer của ERP (máy dev)

MySQL của bot không mở cổng ra ngoài. Nối Adminer (cổng 8081) vào mạng của bot:

```
docker network connect bot-tro-ly_default procurement-tool-adminer-1
```

Rồi đăng nhập Adminer: máy chủ `bot-tro-ly-mysql-1`, người dùng `bot` (mật khẩu = `MYSQL_PASSWORD`
trong `.env`), cơ sở dữ liệu `bot_tro_ly`. Dựng lại container Adminer thì phải nối lại.

Dòng lệnh trong container: `docker compose exec app node dist/cli.js <lệnh>` —
`accounts | groups | company [add <MÃ> "Tên"] | group <mã> read=on files=on company=<MÃ> | stats`.

Dữ liệu nằm ở: MySQL → volume `mysql-data`; tệp tải về → thư mục `./data/files`. Chuyển sang VPS khác
= chép thư mục dự án + `.env` + `./data`, sao lưu/khôi phục MySQL bằng `mysqldump`.

## Giao diện quản trị (`web/`)

Nhân bản khung `frontend-v2` của ERP DEGO (React 19 · Vite · Tailwind 4 · shadcn · TanStack Query):
mọi màn danh sách là một `CrudConfig` chạy qua `CrudListPage` (lọc nhanh, bộ lọc nâng cao, sắp xếp,
phân trang, cột kéo / ghim / ẩn), mọi màn chi tiết qua `CrudDetailPage` (thẻ danh tính, biểu mẫu, tab,
«Lịch sử thao tác» từ bảng `audit_log`). Riêng Hội thoại là màn 3 cột kiểu Zalo. Luật viết mã ở
`web/.claude/rules/` (chép từ ERP, giữ nguyên).

Máy chủ Node chỉ còn: `/api/*` (JSON, phong bì `{success, message, data}` như ERP — mỗi phân hệ một
tệp `src/web/api/*-api.ts`, danh sách đi qua `list-query` + `list-runner`), `/avatars/*`, và bản build
tĩnh của `web/` dưới `/app` (Dockerfile build sẵn, `WEB_DIST_DIR`). Giao diện HTML cũ đã gỡ 01/10/2026.

## Chạy khi phát triển

MySQL của bot nằm trong Docker và **không mở cổng ra máy**; cổng 3306 trên máy dev thường đã bị MySQL của
dự án khác chiếm (gặp 03/10/2026: `Access denied for user 'bot'@'192.168.65.1'` = đang gõ nhầm cửa MySQL
của procurement-tool). Muốn `npm run dev` ngoài Docker:

1. Tạo `docker-compose.override.yml` (đã có trong `.gitignore`, chỉ dùng trên máy mình) mở MySQL ra cổng trống:
   `services: { mysql: { ports: ["127.0.0.1:3308:3306"] } }` → `docker compose up -d mysql`.
2. `.env`: `DATABASE_URL=mysql://bot:<MYSQL_PASSWORD>@127.0.0.1:3308/bot_tro_ly` (compose tự đặt
   `DATABASE_URL` riêng cho container nên không ảnh hưởng bản Docker).
3. `docker compose stop app` trước khi `npm run dev` — trùng cổng 8090, và hai bản cùng chạy là hai phiên Zalo
   của cùng tài khoản bot đá nhau. Quay lại Docker: tắt `npm run dev` rồi `docker compose up -d --build app`.

```
npm install
npm run dev                 # máy chủ bot + API, cần MySQL + .env
npm run typecheck
npm test                    # bài kiểm tích hợp cần TEST_DATABASE_URL

cd web && npm install
npm run dev                 # Vite ở cổng 5175, proxy /api và /avatars về localhost:8090
npm run typecheck && npm run lint
npx vitest run src/modules/<phân hệ>   # chỉ thư mục vừa sửa, không chạy full
```

**Dữ liệu mẫu để thử** (DB dev trống, chưa có tài khoản bot):

```
npm run seed:demo                                   # 2 công ty, 3 nhóm «DEMO · …», 6 người, ~30 tin, 3 tệp
npm run ask -- "tóm tắt nhóm K52 hôm nay"           # hỏi trợ lý dưới tên quản lý demo, không cần Zalo
```

`seed:demo` đi qua đúng các hàm đồng bộ thật (bộ đếm, danh bạ khớp), chạy lại không nhân đôi, mã Zalo đều
bắt đầu `demo-`, bị chặn khi `NODE_ENV=production`. Bot demo tắt sẵn, không có phiên — gửi tin từ web vào
cuộc demo sẽ báo «bot đang tắt», đúng như thật. `ask` dùng đúng cài đặt / công cụ / giới hạn như tin Zalo;
câu hỏi + trả lời lưu vào cuộc riêng của «Nguyễn Văn Duy» (màn Hội thoại, tải lại trang để thấy). Tệp demo
chỉ có tên, không có nội dung — `read_file` báo lỗi là đúng. Dữ liệu: `src/dev/demo-conversations.ts`.

Dòng lệnh khi chạy Node trực tiếp: `npm run cli -- <lệnh>` (cùng bộ lệnh như trên, thêm `login <nhãn>` quét QR bằng tệp ảnh).

## Những điều phải nhớ

- **Sửa `.env` xong phải chạy `docker compose up -d`** (tạo lại container), KHÔNG phải `docker compose restart`
  — restart giữ nguyên biến môi trường cũ (gặp thật 01/10/2026: đổi khóa Gemini mà bot vẫn dùng khóa cũ).
- **Ô đã «đặt trên web» thì sửa `.env` không có tác dụng** — giá trị web đứng trên `.env`. Muốn `.env` ăn lại:
  bấm «Khôi phục mặc định» ở ô đó. Ngược lại khóa Gemini đang lấy từ `.env` thì nút «Xóa» trên web không hiện
  (xóa trên web không tắt được) — muốn tắt trợ lý thì xóa trong `.env`.
- **Cài đặt** (`src/settings/`): danh mục khóa ở `setting-registry.ts` (thêm khóa = thêm một dòng, giao diện tự
  có ô); `SettingsStore` nạp `app_setting` lúc khởi động, phủ lên `AppConfig` đang chạy; lưu xong
  `SyncService.applySettings()` dựng lại trợ lý / trần tệp / giãn cách gửi. Chỗ nào chép giá trị config ra biến
  riêng lúc khởi tạo thì phải thêm đường cập nhật ở `applySettings`. Đổi `SESSION_ENCRYPTION_KEY` = khóa bí mật
  trên web không giải mã được (không sập, màn báo «nhập lại»).
- **Google Sheets** (`src/google/`): tự ký JWT RS256 bằng `node:crypto`, không dùng gói `googleapis`. Câu báo lỗi
  cho quản trị ở `sheets-error-messages.ts` — số bước trong câu khớp «Hướng dẫn 5 bước» trên màn Cài đặt.

- **Không mở Zalo Web bằng tài khoản bot** — mỗi tài khoản một phiên web, mở là bot bị đá (mã 3000).
- Mất `SESSION_ENCRYPTION_KEY` = mọi tài khoản bot phải quét QR lại.
- Người gửi **thu hồi** tin thì bot xóa chữ của tin đó, chỉ giữ dấu vết đã thu hồi.
- Quá `retention_days` của nhóm thì xóa **cả tin lẫn tệp thật** trong kho.
- **Tin cũ trước ngày bot vào nhóm**: Zalo không có API (mây trả `isFiltered`, đo 02/10/2026); Zalo Web chỉ có ~2 tuần do điện
  thoại đồng bộ sang, nội dung trong IndexedDB đã mã hóa; tệp «Xuất dữ liệu» của Zalo PC mã hóa toàn bộ (không đọc được).
  Màn **Nhập lịch sử** (`/app/imports/zalo-web`) đưa hai bookmarklet: «Xuất N nhóm của bot» (nhúng sẵn danh sách nhóm
  `read_messages = 1` từ `GET /api/imports/zalo-web/targets`, tự tìm từng nhóm ở cột trái `#conversationList`
  `[anim-data-id="g<mã>"]`, bấm mở, cuộn lên đầu, mỗi nhóm một tệp) và «Xuất nhóm đang mở». Gom chữ / ảnh (blob → data
  URL) + siêu dữ liệu IndexedDB → JSON → nạp nhiều tệp một lượt qua `POST /api/imports/zalo-web` (chỉ nhóm bot đã ở, trùng
  msgId thì bổ sung ảnh / chữ còn thiếu). Sửa bookmarklet thì chạy thử trên trang giả lập `npx tsx scratch/mock-zalo/run.ts`.
  `src/web/api/imports-api.ts`, `web/src/modules/imports/utils/zalo-web-exporter.ts`. Đăng nhập Zalo Web bằng TÀI KHOẢN BOT
  là bot bị đá (3003).
- Tin hệ thống (`MessageKind.System = 9`, `zalo_msg_type = 'system'`): bot dịch sự kiện nhóm thành câu ở
  `src/zalo/group-event-text.ts` (mã tin tự dựng `sys…` để nhiều bot cùng nhóm không ghi trùng); tin hệ thống nhập từ
  Zalo Web không có mã thật, trùng câu chữ trong 90 giây thì coi là trùng.
- `zalo_group.message_count` / `last_message_at` là bộ đếm cập nhật lúc ghi tin (migration 011) — màn danh
  sách KHÔNG được quét bảng `message` để đếm; thêm đường ghi tin mới thì gọi `bumpThreadCounters`.
- Bot xưng «em», gọi người hỏi «anh/chị» — luật nằm trong `buildSystemPrompt` (assistant-service.ts). Câu trả lời
  chưa về sau 1 giây thì bot nhắn «chờ em một xíu» trước — tin riêng lẫn nhóm (`src/zalo/assistant-ack.ts`). Thiếu đối tượng
  (tệp / nhóm / người nào) thì bot HỎI LẠI kèm danh sách, không đoán; `search_files` query rỗng = tệp gần đây của người hỏi.
- **Đọc tệp** (`read_file`, `src/assistant/file-reader.ts`): xlsx / docx / txt / csv tự bóc (SheetJS + bộ đọc zip tự viết),
  pdf / ảnh nhờ Gemini đọc, ghi âm (mp3, m4a, wav, aac) nhờ Gemini nghe — gỡ băng + tóm tắt (đo 06/10/2026: bản lite
  3,6 giây / đoạn 15 giây); video không đọc. Loại được đọc: Cài đặt → «Loại tệp bot được đọc» (chặn cả chữ đã bóc sẵn). Chữ bóc ra CẤT ở `attachment_text` (migration 012): bot và màn Tệp tìm được theo
  nội dung, đọc lại không tốn token. Tối đa `ASSISTANT_MAX_READ_FILE_MB` (5). Lượt có đọc tệp hoặc dữ liệu
  công cụ > 24.000 ký tự đi mô hình `GEMINI_MODEL_HEAVY` (flash) thay vì lite.
- Giao diện theo khuôn ERP DEGO (bảng màu trong `web/src/index.css`); mọi màn mới phải đi qua `CrudListPage` / `CrudDetailPage`, không vẽ tay.
- `zca-js` 2.2.0 đóng gói lỗi kiểu (`index.d.ts` gốc trỏ thư mục) — `tsconfig.json` có `paths` vá chỗ đó.
