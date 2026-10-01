# bot-tro-ly

Bot trợ lý đọc các nhóm Zalo công việc. **Bản hiện tại: đồng bộ cơ bản + trợ lý AI** — tài khoản
bot đọc nhóm, lưu tin + thành viên nhóm, tải file ngay lúc tin tới, trả lời tin riêng bằng Gemini,
kèm giao diện web quản trị (`web/`, khung ERP v2) dưới `/app`: Hội thoại, Danh bạ, Nhóm, Tệp, Công ty,
Tài khoản bot (đăng nhập QR). Màn Hội thoại nhận tin mới tức thời (kênh đẩy SSE `/api/events`) và có ô
soạn tin: quản trị gõ chữ / gửi tệp từ web, đi ra Zalo **dưới tên tài khoản bot**, lưu lại với nhãn «quản trị».

Thiết kế: [`doc/01-thiet-ke-ban-dau.md`](doc/01-thiet-ke-ban-dau.md).

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

Máy chỉ cần Docker, không cần cài Node. Hai container: `app` (đồng bộ + giao diện, ~35 MB RAM) và
`mysql` (~210 MB). Đã chạy thử đủ vòng 01/10/2026: build, migration tự chạy, giao diện, lấy QR Zalo
từ trong container, dòng lệnh.

```
cp .env.example .env
docker compose build
docker compose run --rm --no-deps app node dist/cli.js gen-key   # dán vào SESSION_ENCRYPTION_KEY
# điền tiếp MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, ADMIN_PASSWORD (≥ 12 ký tự) trong .env
docker compose up -d
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

Đặt `GEMINI_API_KEY` trong `.env` là bật. Người có vai trò nhắn riêng cho bot, hỏi được:
tóm tắt nhóm theo thời gian · đã bàn gì với một người · tìm tệp và nhận tệp. Quyền hiện **mở hết**
(mọi vai trò hỏi được mọi nhóm). Mô hình chính `gemini-3.5-flash-lite` (đo 01/10/2026: 2–4 giây/câu);
quá tải hoặc hết hạn mức thì tự chuyển sang `GEMINI_FALLBACK_MODELS`. Mỗi lượt hỏi ghi ở bảng
`assistant_turn` (token, công cụ đã gọi, lỗi). Giới hạn: `ASSISTANT_MAX_PER_HOUR` câu/người/giờ,
`ASSISTANT_DAILY_TOKEN_CAP` token/ngày, bot gửi tin cách nhau `ASSISTANT_SEND_INTERVAL_MS`.

**Tìm web** (`web_search`, Google Search qua Gemini): bot tra giá thị trường, tin tức, quy định… kèm
nguồn. Gói miễn phí của Gemini KHÔNG có tìm web (đo 01/10/2026: 429) — bật thanh toán cho khóa thì chạy
ngay: 5.000 lượt tìm miễn phí/tháng, sau đó 14 USD/1.000 lượt (bảng giá Google 01/10/2026). Chưa bật thì
bot trả lời người hỏi là tìm web chưa bật.

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

Dòng lệnh khi chạy Node trực tiếp: `npm run cli -- <lệnh>` (cùng bộ lệnh như trên, thêm `login <nhãn>` quét QR bằng tệp ảnh).

## Những điều phải nhớ

- **Sửa `.env` xong phải chạy `docker compose up -d`** (tạo lại container), KHÔNG phải `docker compose restart`
  — restart giữ nguyên biến môi trường cũ (gặp thật 01/10/2026: đổi khóa Gemini mà bot vẫn dùng khóa cũ).

- **Không mở Zalo Web bằng tài khoản bot** — mỗi tài khoản một phiên web, mở là bot bị đá (mã 3000).
- Mất `SESSION_ENCRYPTION_KEY` = mọi tài khoản bot phải quét QR lại.
- Người gửi **thu hồi** tin thì bot xóa chữ của tin đó, chỉ giữ dấu vết đã thu hồi.
- Quá `retention_days` của nhóm thì xóa **cả tin lẫn tệp thật** trong kho.
- `zalo_group.message_count` / `last_message_at` là bộ đếm cập nhật lúc ghi tin (migration 011) — màn danh
  sách KHÔNG được quét bảng `message` để đếm; thêm đường ghi tin mới thì gọi `bumpThreadCounters`.
- Bot xưng «em», gọi người hỏi «anh/chị» — luật nằm trong `buildSystemPrompt` (assistant-service.ts). Câu trả lời
  chưa về sau 2,5 giây thì bot nhắn «em nhận được rồi» trước (`ACK_DELAY_MS` ở account-runner). Thiếu đối tượng
  (tệp / nhóm / người nào) thì bot HỎI LẠI kèm danh sách, không đoán; `search_files` query rỗng = tệp gần đây của người hỏi.
- **Đọc tệp** (`read_file`, `src/assistant/file-reader.ts`): xlsx / docx / txt / csv tự bóc (SheetJS + bộ đọc zip tự viết),
  pdf / ảnh nhờ Gemini đọc. Chữ bóc ra CẤT ở `attachment_text` (migration 012): bot và màn Tệp tìm được theo
  nội dung, đọc lại không tốn token. Tối đa `ASSISTANT_MAX_READ_FILE_MB` (5). Lượt có đọc tệp hoặc dữ liệu
  công cụ > 24.000 ký tự đi mô hình `GEMINI_MODEL_HEAVY` (flash) thay vì lite.
- Giao diện theo khuôn ERP DEGO (bảng màu trong `web/src/index.css`); mọi màn mới phải đi qua `CrudListPage` / `CrudDetailPage`, không vẽ tay.
- `zca-js` 2.2.0 đóng gói lỗi kiểu (`index.d.ts` gốc trỏ thư mục) — `tsconfig.json` có `paths` vá chỗ đó.
