# Phase B — màn Cài đặt + Google Sheets: kế hoạch thi công

> Bản 1.0 · 02/10/2026 · người giao: đại ca · người làm: đồng nghiệp (bàn giao) · nền: nhánh `dev1` tại
> commit `d71c380`. Lộ trình chung: [`03-mo-ta-chuc-nang.md`](03-mo-ta-chuc-nang.md) mục 7.
> Ước lượng: **1,5–2 ngày** cho người mới vào kho (1 ngày nếu đã quen mã).

## 0. Mục tiêu

1. **Cài đặt trên web, không build lại:** quản trị đổi khóa Gemini, mô hình, các trần, mặc định nhóm… trên
   màn **Cài đặt**; lưu là có hiệu lực ngay (hoặc ghi rõ «áp dụng khi bot khởi động lại»). Hiện mọi thứ nằm
   trong `.env`, muốn đổi phải sửa tệp + khởi động lại container.
2. **Kết nối Google Sheets** bằng *service account*: dán tệp JSON khóa vào Cài đặt, dán link trang tính,
   bấm **Kiểm tra kết nối** → hệ thống ghi thử một dòng vào trang tính và báo kết quả dễ hiểu. Phase G sau
   này dùng client này để xuất báo cáo; phase B **chỉ** làm client + nút kiểm tra.

**Xong khi** (định nghĩa hoàn thành):

- Đổi `gemini_model` trên web → câu hỏi kế tiếp gửi bot đi đúng mô hình mới, không khởi động lại container.
- Xóa khóa Gemini trên web → bot vẫn lưu tin, thôi trả lời (như khi `.env` trống khóa); đặt lại → trả lời lại.
- Khóa bí mật không bao giờ đi ra khỏi máy chủ nguyên văn (API, log, nhật ký thao tác, giao diện).
- «Kiểm tra kết nối» với trang tính đã chia sẻ → có dòng mới trong tab `Bot trợ lý`; với trang chưa chia sẻ →
  câu báo lỗi nói đúng việc cần làm («chia sẻ trang tính cho …@….iam.gserviceaccount.com»).
- Tab «Lịch sử thay đổi» của màn Cài đặt có dòng cho mỗi lần lưu (ô nào đổi; ô bí mật chỉ ghi «đã đổi»).
- Các cổng kiểm ở mục 9 xanh.

**Ngoài phạm vi** (đừng làm trong phase này): xuất báo cáo thật ra Sheets (phase G); giờ gửi bản tin, ngưỡng
«chưa trả lời X giờ» (chưa có mã nào đọc — thêm khóa khi phase D / G cần, registry ở mục 3 làm việc đó mất 5
phút); OAuth đăng nhập Google; nhiều trang tính.

## 1. Đọc trước khi code (khoảng 1 giờ)

| Tệp | Vì sao |
|---|---|
| `CLAUDE.md`, `README.md` | luật chung của kho, cách chạy, cổng kiểm |
| `web/.claude/rules/*.md` | luật viết mã giao diện (đặt tên, TypeScript, component, style, test) — **bắt buộc** |
| `src/config.ts` | nơi đang đọc `.env` → `AppConfig`; phase B phủ giá trị DB lên đây |
| `src/crypto/session-cipher.ts` | `encryptJson` / `decryptJson` (AES-256-GCM, khóa `SESSION_ENCRYPTION_KEY`) — dùng lại cho khóa bí mật |
| `src/sync-service.ts` | dựng `AssistantService` + `AttachmentDownloader`, tạo `AccountRunner` — nơi phải nạp lại khi cài đặt đổi |
| `src/zalo/account-runner.ts` | runner giữ tham chiếu `assistant` và đọc `this.config.defaultGroupRead`… |
| `src/sync/attachment-downloader.ts` | `options.maxFileBytes` được chép lúc dựng — đổi trên web phải có đường cập nhật |
| `src/web/api/imports-api.ts`, `groups-api.ts` | mẫu một tệp API: `ApiRoute[]`, `sendOk`, `ApiError`, `readJson` |
| `src/web/api/audit-log.ts` | `recordAudit`, `diffFields`, `ACTION_LABEL`, kiểu `AuditEntity` |
| `src/web/api/permissions.ts` + `web/src/core/authorization/permission-types.ts` | `ENTITIES` hai phía phải khớp |
| `web/src/modules/imports/` | mẫu một phân hệ giao diện nhỏ: `api/ hooks/ pages/ types/ utils/ routes.tsx` |
| `web/src/shared/audit/audit-timeline.tsx` | tab «Lịch sử thay đổi» dùng lại component này |

## 2. Quyết định thiết kế (đã chốt — làm theo, có lý do kèm)

1. **Nguồn giá trị và thứ tự ưu tiên:** giá trị đặt trên web (bảng `app_setting`) > biến `.env` > mặc định
   trong mã. `.env` vẫn là cách cài lần đầu; web phủ lên. «Khôi phục mặc định» = **xóa dòng** trong
   `app_setting` → quay về giá trị `.env`. Giao diện hiện rõ mỗi ô đang lấy từ đâu (`web` / `.env` / `mặc định`).
2. **Những thứ KHÔNG đưa lên web** (giữ ở `.env`): `DATABASE_URL`, `SESSION_ENCRYPTION_KEY`, `ADMIN_PASSWORD`,
   `WEB_HOST`, `WEB_PORT`, `COOKIE_SECURE`, `TRUST_CLOUDFLARE_IP`, `WEB_DIST_DIR`, `DATA_DIR`, `STORAGE_DRIVER`,
   `R2_*`, `DOWNLOAD_CONCURRENCY`, `HEARTBEAT_SECONDS`. Lý do: cần có TRƯỚC khi vào được DB / web (gà – trứng),
   hoặc sửa sai trên web là tự khóa mình ngoài (mật khẩu, cổng, khóa mã hóa), hoặc đổi giữa chừng làm hỏng dữ
   liệu (nơi cất tệp).
3. **Khóa bí mật** (`gemini_api_key`, `google_service_account_json`): lưu bằng `encryptJson(value,
   config.sessionEncryptionKey)`. API **không bao giờ** trả giá trị; chỉ trả `{ is_set, hint }` với `hint` = 4 ký tự
   cuối của khóa Gemini, hoặc `client_email` của service account (email không bí mật, quản trị cần nó để chia
   sẻ trang tính). PATCH gửi chuỗi rỗng / bỏ trống ô bí mật = **giữ nguyên**; muốn xóa thì gọi reset.
4. **Có hiệu lực ngay:** sau mỗi lần lưu, máy chủ phủ giá trị mới lên chính đối tượng `AppConfig` đang chạy
   (mọi nơi đang giữ tham chiếu tới nó thấy ngay), rồi gọi `SyncService.applySettings()` để dựng lại những
   thứ đã chép giá trị lúc khởi tạo (trợ lý AI, giới hạn tải tệp, giãn cách gửi). Không cần khởi động lại.
5. **Google không dùng thư viện `googleapis`:** gói đó vài chục MB cho đúng 3 lời gọi REST. Tự ký JWT RS256 bằng
   `node:crypto` (`crypto.sign("RSA-SHA256", …)`), đổi lấy access token ở `https://oauth2.googleapis.com/token`,
   gọi Sheets API v4 bằng `fetch`. Khoảng 120 dòng, kiểm được không cần mạng (tiêm `fetch` + đồng hồ).
6. **Một quản trị duy nhất** như hiện tại (`ADMIN_PASSWORD`) — thêm thực thể quyền `setting` cho đủ khung,
   ma trận vẫn cấp đủ.

## 3. Danh mục khóa cài đặt

Khai **một chỗ** ở `src/settings/setting-registry.ts`. Thêm khóa sau này = thêm một dòng vào mảng.

| Khóa | Thẻ trên màn | Kiểu | Biến `.env` | Mặc định | Bí mật | Ràng buộc | Có hiệu lực |
|---|---|---|---|---|---|---|---|
| `gemini_api_key` | Trợ lý AI | chuỗi | `GEMINI_API_KEY` | (trống = trợ lý tắt) | có | ≤ 200 ký tự, không khoảng trắng | ngay (dựng lại trợ lý) |
| `gemini_model` | Trợ lý AI | chuỗi | `GEMINI_MODEL` | `gemini-3.5-flash-lite` | | `^[a-z0-9.\-]{3,80}$` | ngay |
| `gemini_model_heavy` | Trợ lý AI | chuỗi | `GEMINI_MODEL_HEAVY` | `gemini-3.5-flash` | | như trên, cho phép trống (= dùng mô hình chính) | ngay |
| `gemini_fallback_models` | Trợ lý AI | danh sách | `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash,gemini-flash-latest` | | tối đa 5 tên, mỗi tên như trên | ngay |
| `assistant_max_per_hour` | Trợ lý AI | số nguyên | `ASSISTANT_MAX_PER_HOUR` | 30 | | 1–1000 | ngay |
| `assistant_daily_token_cap` | Trợ lý AI | số nguyên | `ASSISTANT_DAILY_TOKEN_CAP` | 3 000 000 | | 10 000–100 000 000 | ngay |
| `assistant_max_read_file_mb` | Trợ lý AI | số nguyên | `ASSISTANT_MAX_READ_FILE_MB` | 5 | | 1–20 | ngay |
| `assistant_send_interval_ms` | Trợ lý AI | số nguyên | `ASSISTANT_SEND_INTERVAL_MS` | 1500 | | 500–10 000 (dưới 500 dễ bị Zalo khóa) | ngay |
| `default_group_read` | Đồng bộ Zalo | bật/tắt | `DEFAULT_GROUP_READ` | tắt | | | nhóm mới từ lúc lưu |
| `default_group_capture_files` | Đồng bộ Zalo | bật/tắt | `DEFAULT_GROUP_CAPTURE_FILES` | tắt | | | nhóm mới từ lúc lưu |
| `default_dm_read` | Đồng bộ Zalo | bật/tắt | `DEFAULT_DM_READ` | bật | | | cuộc riêng mới từ lúc lưu |
| `default_dm_capture_files` | Đồng bộ Zalo | bật/tắt | `DEFAULT_DM_CAPTURE_FILES` | bật | | | cuộc riêng mới từ lúc lưu |
| `max_file_mb` | Đồng bộ Zalo | số nguyên | `MAX_FILE_MB` | 100 | | 1–500 | tệp tải từ lúc lưu |
| `google_service_account_json` | Google Sheets | JSON | — | (trống) | có | xem mục 6.2 | ngay |
| `google_spreadsheet_url` | Google Sheets | chuỗi | — | (trống) | | link chứa `/spreadsheets/d/<id>` hoặc chỉ `<id>` (25–60 ký tự `[A-Za-z0-9_-]`) | ngay |

Mỗi dòng registry là một object:

```ts
interface SettingDefinition {
  key: string                      // khóa, snake_case tiếng Anh
  group: 'assistant' | 'sync' | 'google'
  label: string                    // nhãn tiếng Việt hiện trên màn
  help: string                     // một câu giải thích, hiện dưới ô
  type: 'string' | 'int' | 'bool' | 'list' | 'json'
  envName: string | null           // biến .env tương ứng (null = chỉ có trên web)
  defaultValue: string | number | boolean | string[] | null
  secret: boolean
  min?: number; max?: number; pattern?: RegExp; maxLength?: number
  applyTo: (config: AppConfig, value: unknown) => void   // phủ giá trị lên AppConfig (vd MB → byte)
}
```

## 4. Dữ liệu — migration `014_app_setting.sql`

```sql
-- 02/10/2026 (phase B): cài đặt sửa trên web, phủ lên .env. Không có dòng = dùng .env / mặc định.
-- Khóa bí mật (khóa Gemini, JSON service account) lưu đã mã hóa bằng SESSION_ENCRYPTION_KEY.
CREATE TABLE app_setting (
  setting_key  VARCHAR(80)  NOT NULL PRIMARY KEY,
  -- Giá trị dạng JSON (số, chuỗi, mảng, true/false); khóa bí mật: chuỗi "v1.<iv>.<tag>.<body>" của encryptJson
  value        MEDIUMTEXT   NOT NULL,
  is_secret    TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by   VARCHAR(100) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Số 014 là số kế tiếp — kiểm lại `ls migrations` trước khi tạo, có ai chen số thì lấy số sau. Migration tự chạy
lúc container khởi động (`src/db/migrate.ts`), không có bước lùi.

## 5. Máy chủ — các bước

Mỗi bước kết thúc bằng `npm run typecheck` + bài kiểm của bước đó xanh rồi mới sang bước sau.

### B1. `src/settings/setting-registry.ts` (hàm thuần) — 2 giờ

- `SETTING_DEFINITIONS: SettingDefinition[]` theo bảng mục 3.
- `findSetting(key): SettingDefinition | undefined`.
- `parseSettingInput(definition, raw: unknown): unknown` — nhận giá trị từ PATCH, ép kiểu + kiểm ràng buộc, sai
  thì `throw new ApiError(422, "validation_error", "<nhãn>: <lý do tiếng Việt>")`. Ví dụ: số nhận cả `"30"` lẫn
  `30`, từ chối `30.5`, `"abc"`, ngoài khoảng; `list` nhận mảng hoặc chuỗi cách bằng dấu phẩy, bỏ phần tử rỗng,
  bỏ trùng; `bool` nhận `true/false` (không nhận `"có"`).
- `readEnvValue(definition, env = process.env)` — đọc giá trị `.env` theo đúng cách `config.ts` đang đọc (để màn
  hiện «đang lấy từ .env: …» khớp với thật).
- **Bài kiểm** `setting-registry.test.ts` (node:test, xem `src/web/api/imports-api.test.ts` làm mẫu): mỗi kiểu
  một ca hợp lệ + các ca phá (rỗng, âm, 0, vượt trần, số thực, chuỗi chữ, mảng 6 phần tử, tên mô hình có khoảng
  trắng / ký tự lạ, URL trang tính sai), và một ca canh: **mọi** `envName` trong registry đều có trong
  `.env.example` (đổi tên biến một bên là bài kiểm đỏ).

### B2. `src/settings/settings-store.ts` — 3 giờ

```ts
export class SettingsStore {
  constructor(db: Db, config: AppConfig)
  /** Đọc mọi dòng app_setting, giải mã khóa bí mật, phủ lên config. Gọi một lần lúc khởi động. */
  load(): Promise<void>
  /** Cho API: mỗi khóa một mục { key, group, label, help, type, value | null, is_set, hint, source, env_value, default_value, min, max } — khóa bí mật value luôn null. */
  describe(): SettingView[]
  /** Lưu nhiều khóa một lượt (một transaction), phủ lên config, trả danh sách khóa thật sự đổi. */
  save(changes: Record<string, unknown>, actor: string): Promise<string[]>
  /** Xóa dòng → quay về .env / mặc định, phủ lại config. */
  reset(key: string, actor: string): Promise<boolean>
  /** Giá trị đã giải mã — CHỈ dùng nội bộ máy chủ (vd Google client), không bao giờ đưa ra API. */
  getSecret(key: string): unknown
}
```

Chi tiết phải đúng:

- `source`: `"web"` khi có dòng trong bảng, `"env"` khi không có dòng nhưng biến `.env` có giá trị, còn lại
  `"default"`.
- Khóa bí mật: `save` với giá trị `""` / `null` / thiếu = bỏ qua (giữ nguyên). Mã hóa bằng `encryptJson`. Giải mã
  lỗi lúc `load` (đổi `SESSION_ENCRYPTION_KEY`) → **không làm sập** máy chủ: log cảnh báo (không in giá trị), coi
  như chưa đặt, `describe` trả `hint: "không giải mã được — nhập lại"`.
- `hint` của `gemini_api_key` = `"…" + 4 ký tự cuối`; của `google_service_account_json` = `client_email`.
- «Thật sự đổi»: so giá trị mới với giá trị đang hiệu lực; không đổi thì không ghi DB, không ghi nhật ký.
- Phủ lên config bằng `definition.applyTo(config, value)`; khi reset thì `applyTo(config, envValue ?? default)`.
- Sửa `src/main.ts`: sau `runMigrations` + `createPool`, **trước** `new SyncService(...)`: `const settings = new
  SettingsStore(db, config); await settings.load();` rồi truyền `settings` vào `SyncService` (để API dùng qua
  `service.settings`).
- **Bài kiểm**: phần thuần (tính `source`, `hint`, so «thật sự đổi», mã hóa → giải mã vòng tròn, giải mã hỏng
  không ném lỗi) tách thành hàm riêng để kiểm không cần DB.

### B3. Nạp lại khi cài đặt đổi — 2 giờ

Trong `src/sync-service.ts`:

- `private assistant` (bỏ `readonly` nếu có) + hàm `private buildAssistant(): AssistantService | null` tách từ
  constructor hiện tại (dòng dựng `new AssistantService(...)`), constructor gọi lại hàm này.
- `applySettings(changedKeys: string[]): void`:
  - đổi bất kỳ khóa `gemini_*` / `assistant_*` (trừ `assistant_send_interval_ms`) → `this.assistant =
    this.buildAssistant()` rồi `runner.setAssistant(this.assistant)` cho mọi runner đang chạy; log
    «trợ lý AI dựng lại (<mô hình>)» hoặc «trợ lý AI tắt — chưa có khóa Gemini».
  - `max_file_mb` → `this.downloader.setMaxFileBytes(config.maxFileBytes)` (thêm hàm này vào
    `AttachmentDownloader`, chỉ gán `this.options.maxFileBytes`).
  - `assistant_send_interval_ms` → `runner.setSendInterval(ms)` cho mọi runner (thêm vào `AccountRunner`, gọi
    xuống `ZaloSender` — thêm setter ở đó).
  - `default_*` không cần làm gì: runner đọc `this.config.defaultGroupRead`… mỗi lần dùng, và `config` là cùng
    một đối tượng — **kiểm lại** bằng cách tìm `config.default` trong `src/` để chắc không nơi nào chép ra biến riêng.
- `AccountRunner.setAssistant(assistant: AssistantService | null)`: thay tham chiếu; lượt hỏi đang chạy dở thì
  chạy nốt bằng bản cũ (không hủy).
- Lượt hỏi đang dở khi đổi khóa: chấp nhận được, không cần khóa / chờ.

### B4. API `src/web/api/settings-api.ts` — 2 giờ

| Phương thức | Đường | Thân / kết quả |
|---|---|---|
| GET | `/api/settings` | `data: SettingView[]` (mục B2), xếp theo thứ tự registry |
| PATCH | `/api/settings` | thân `{ "<key>": <giá trị>, … }` (một hay nhiều khóa). Khóa lạ → 422 «Không có cài đặt <key>». Kiểm hết rồi mới ghi (một khóa sai thì không ghi khóa nào). Trả `data: SettingView[]` mới, `message: "Đã lưu n cài đặt"` hoặc `"Không có gì thay đổi"` |
| POST | `/api/settings/:key/reset` | xóa giá trị web của một khóa; trả `SettingView[]` |
| POST | `/api/settings/google/test` | không thân; dùng giá trị ĐÃ LƯU; trả `data: { ok: true, spreadsheet_title, sheet_title, appended_range }` hoặc lỗi 422 với câu dễ hiểu (mục 6.3) |

- Đăng ký trong `src/web/api/api-router.ts` (nối mảng `settingRoutes` như các phân hệ khác).
- Nhật ký thao tác: `recordAudit(db, { entity: "setting", entityId: 1, action: "update", changedFields:
  [nhãn các ô đổi] })`. Khóa bí mật chỉ ghi nhãn («Khóa Gemini»), **không** ghi giá trị cũ / mới. Reset →
  `action: "reset"`; kiểm tra Google → `action: "test_connection"`, `message: "Kết nối Google Sheets: thành công"`
  hoặc «lỗi: <câu báo lỗi>». Thêm `"setting"` vào kiểu `AuditEntity`, thêm nhãn `reset` / `test_connection` vào
  `ACTION_LABEL`. `entityId` cố định 1 vì Cài đặt là một bản ghi duy nhất.
- Quyền: thêm `"setting"` vào `ENTITIES` ở `src/web/api/permissions.ts` **và**
  `web/src/core/authorization/permission-types.ts` (hai mảng phải khớp; thiếu bên web thì mục menu bị ẩn).
- **Không** log thân PATCH (có khóa bí mật). Kiểm `src/web/server.ts` / lớp log lỗi API: lỗi 422 chỉ log câu báo,
  không log body.

## 6. Google Sheets — `src/google/`

### 6.1 Việc đại ca (hoặc người quản trị Google) làm trên Google Cloud Console — 10 phút

Viết đúng 5 bước này vào phần trợ giúp trên màn Cài đặt (thẻ Google Sheets) và vào README:

1. Vào https://console.cloud.google.com → chọn / tạo project (vd `bot-tro-ly`).
2. **APIs & Services → Library** → tìm **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** → đặt tên (vd `bot-tro-ly-sheets`) → bỏ qua phần
   cấp quyền → Done.
4. Mở service account vừa tạo → tab **Keys → Add key → Create new key → JSON** → tệp `.json` tự tải về. **Không
   gửi tệp này qua Zalo / email**; mở bằng Notepad, chép toàn bộ nội dung, dán vào ô «Khóa service account» trên
   màn Cài đặt.
5. Mở Google Sheet muốn bot ghi vào → **Chia sẻ** → dán email của service account (dạng
   `…@<project>.iam.gserviceaccount.com`, màn Cài đặt hiện sẵn sau khi dán khóa) → quyền **Người chỉnh sửa** →
   bỏ tick «Thông báo» → Chia sẻ. Chép link trang tính dán vào ô «Link trang tính».

### 6.2 `src/google/service-account.ts` (hàm thuần) — 1 giờ

- `parseServiceAccount(raw: unknown): ServiceAccount` — nhận chuỗi JSON hoặc object; bắt buộc
  `type === "service_account"`, `client_email` (đuôi `.iam.gserviceaccount.com`), `private_key` bắt đầu
  `-----BEGIN PRIVATE KEY-----`, `token_uri` (mặc định `https://oauth2.googleapis.com/token`). Thiếu / sai → 422
  với câu nói rõ («Đây không phải tệp khóa service account — thiếu private_key»). Chấp nhận `private_key` có
  `\n` đã bị thoát thành `\\n` (hay gặp khi dán) → đổi lại thành xuống dòng thật.
- `parseSpreadsheetId(input: string): string` — nhận link đầy đủ (`…/spreadsheets/d/<id>/edit#gid=0`) hoặc id trần.
- **Bài kiểm**: JSON hỏng, thiếu từng trường, sai `type`, khóa có `\\n`, link có / không `edit`, link Google
  Docs (không phải Sheets) → lỗi, id quá ngắn → lỗi.

### 6.3 `src/google/sheets-client.ts` — 3 giờ

```ts
export class GoogleSheetsClient {
  constructor(account: ServiceAccount, options?: { fetcher?: typeof fetch; now?: () => number })
  /** JWT RS256 → access token, nhớ đệm tới (exp − 60 giây). */
  getAccessToken(): Promise<string>
  getSpreadsheet(spreadsheetId: string): Promise<{ title: string; sheets: { title: string; sheetId: number }[] }>
  /** Có tab tên này chưa — chưa thì tạo (batchUpdate addSheet). */
  ensureSheet(spreadsheetId: string, title: string): Promise<void>
  /** Ghi nối dòng; trả vùng đã ghi (vd "'Bot trợ lý'!A5:C5"). */
  appendRows(spreadsheetId: string, sheetTitle: string, rows: (string | number)[][]): Promise<string>
}

/** Nút «Kiểm tra kết nối»: đọc tiêu đề → bảo đảm tab "Bot trợ lý" → ghi một dòng [giờ VN, "Kết nối thử từ Bot trợ lý", client_email]. */
export async function testSheetsConnection(client, spreadsheetId): Promise<{ spreadsheet_title; sheet_title; appended_range }>
```

- JWT: header `{"alg":"RS256","typ":"JWT"}`, claim `{ iss: client_email, scope:
  "https://www.googleapis.com/auth/spreadsheets", aud: token_uri, iat, exp: iat + 3600 }`, mã base64url, ký
  `crypto.sign("RSA-SHA256", Buffer.from(header + "." + claim), private_key)`. Đổi token: POST `token_uri`,
  `Content-Type: application/x-www-form-urlencoded`, thân `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`.
- Sheets API v4: `GET https://sheets.googleapis.com/v4/spreadsheets/{id}?fields=properties.title,sheets.properties`;
  `POST …/{id}:batchUpdate` thân `{ requests: [{ addSheet: { properties: { title } } }] }`;
  `POST …/{id}/values/{range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS` thân
  `{ values: rows }`, `range` = `'<tên tab>'!A1` (tên tab có dấu cách phải bọc nháy đơn, nháy đơn trong tên nhân đôi).
- Mọi lời gọi có `AbortSignal.timeout(15_000)`.
- **Dịch lỗi thành câu cho quản trị** (đây là phần đáng giá nhất của nút kiểm tra — làm kỹ):

| Google trả | Câu báo |
|---|---|
| token: `invalid_grant` | «Khóa service account bị từ chối — khóa đã bị xóa trên Google Cloud, hoặc đồng hồ máy chủ lệch giờ. Tạo khóa mới rồi dán lại.» |
| 403 + `SERVICE_DISABLED` / «has not been used in project» | «Project chưa bật Google Sheets API — làm bước 2 trong hướng dẫn.» |
| 403 `PERMISSION_DENIED` | «Trang tính chưa chia sẻ cho <client_email> (quyền Người chỉnh sửa) — làm bước 5.» |
| 404 | «Không tìm thấy trang tính — kiểm tra lại link.» |
| 429 | «Google đang giới hạn số lần gọi — thử lại sau một phút.» |
| lỗi mạng / quá 15 giây | «Không gọi được Google (mạng / tường lửa của máy chủ).» |
| chưa đặt khóa hoặc link | «Chưa dán khóa service account» / «Chưa có link trang tính» (422, không gọi mạng) |

- **Bài kiểm** `sheets-client.test.ts` — **không gọi mạng thật**, tiêm `fetcher` giả:
  - Sinh cặp khóa trong bài kiểm bằng `crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })`, cho client
    ký JWT, rồi `crypto.verify` bằng khóa công khai → chữ ký đúng; claim có đúng `iss/scope/aud`, `exp − iat = 3600`.
  - Token được nhớ đệm: hai lời gọi liền nhau chỉ đổi token một lần; đồng hồ tiến quá `exp − 60` thì đổi lại.
  - `ensureSheet`: tab đã có → không gọi `batchUpdate`; chưa có → gọi đúng một lần.
  - Tên tab có dấu cách / nháy đơn được bọc đúng trong `range`.
  - Mỗi dòng của bảng dịch lỗi ở trên một ca.

## 7. Giao diện — `web/src/modules/settings/`

Cấu trúc như `modules/imports`: `types/setting.ts`, `api/setting-api.ts`, `hooks/use-settings.ts`,
`pages/settings-page.tsx`, `components/…`, `routes.tsx`. Khóa query thêm vào
`web/src/shared/constants/query-keys.ts` (`settings: { all, list }`) — không viết chuỗi khóa trần.

- **Đường dẫn + menu:** `appRoutes.settings = '/settings'`; mục menu cuối danh sách «Cài đặt», icon `Settings`
  (lucide), `entity: 'setting'` (`web/src/app/router/nav-items.ts`); đăng ký `settingsModule` trong
  `app-router.tsx`.
- **Bố cục:** `PageContainer` + `PageHeader` («Cài đặt», mô tả «Sửa ở đây có hiệu lực ngay, không cần khởi động
  lại. Ô để trống trên web thì dùng giá trị trong .env.»). Bốn tab: **Trợ lý AI · Đồng bộ Zalo · Google Sheets ·
  Lịch sử thay đổi**. Mỗi tab một `FormCard`; ô vẽ từ dữ liệu `GET /api/settings` (lọc theo `group`) — **không**
  viết tay từng ô: một component `SettingField` chọn kiểu ô theo `type`.
- **`SettingField`:**
  - `int` → `Input type="number"` + min/max; `string` → `Input`; `bool` → `Switch`/`Checkbox` sẵn có trong
    `shared/ui`; `list` → `Input` cách bằng dấu phẩy (hiện gợi ý); `json` → `Textarea` cao 8 dòng, phông mono.
  - Dưới mỗi ô: câu `help` + nhãn nguồn: `Pill` «đặt trên web» (kèm nút nhỏ «Khôi phục mặc định» → reset) /
    «từ .env: <giá trị>» / «mặc định: <giá trị>».
  - **Ô bí mật** (`SecretSettingField`): khi `is_set` hiện «Đã đặt · <hint>» + nút «Đổi» (mở ô nhập trống) và
    «Xóa» (`ConfirmDialog` → reset). Không bao giờ điền giá trị cũ vào ô. Khóa service account sau khi lưu hiện
    `client_email` kèm `CopyButton` (để dán vào bước chia sẻ).
- **Lưu:** react-hook-form + zod (đã có trong `package.json`), schema dựng từ min/max/type của API. Một nút
  «Lưu» mỗi tab, chỉ gửi các ô đã đổi (`dirtyFields`), ô bí mật để trống thì không gửi. Thành công →
  `toast.success(message)` + làm mới query; lỗi 422 → `toast.error` với câu từ máy chủ.
- **Tab Google Sheets:** thêm khối «Hướng dẫn 5 bước» (mục 6.1, dạng danh sách đánh số, link Console mở tab mới)
  và nút **«Kiểm tra kết nối»** (`Loader2` khi chạy) → hiện kết quả ngay dưới nút: xanh «Đã ghi thử vào
  "<tên trang tính>" › "Bot trợ lý" (<vùng>)» hoặc đỏ với câu báo lỗi. Nút bị khóa khi chưa có khóa hoặc link
  (kèm câu giải thích vì sao khóa).
- **Tab Lịch sử thay đổi:** `<AuditTimeline entity="setting" entityId={1} showMessage />`.
- **Bài kiểm (vitest, chỉ thư mục `src/modules/settings`):** dựng schema zod từ dữ liệu API (min/max/kiểu, ô
  trống), hàm chọn «các ô đã đổi để gửi» (ô bí mật trống không gửi, ô không đổi không gửi), `SettingField` hiện
  đúng nhãn nguồn, ô bí mật không bao giờ hiện giá trị, nút «Kiểm tra kết nối» khóa khi thiếu khóa / link.

## 8. Thứ tự làm và ước lượng

| # | Việc | Giờ |
|---|---|---|
| 1 | Đọc mục 1 | 1 |
| 2 | B1 registry + bài kiểm | 2 |
| 3 | Migration 014 + B2 store + sửa `main.ts` | 3 |
| 4 | B3 nạp lại (SyncService / runner / downloader / sender) | 2 |
| 5 | B4 API + nhật ký + quyền | 2 |
| 6 | 6.2 + 6.3 Google client + bài kiểm | 4 |
| 7 | Giao diện mục 7 + bài kiểm | 5 |
| 8 | Kiểm tay mục 9, README, doc 03 | 1 |
| | **Cộng** | **~20 giờ** |

Làm theo thứ tự này: máy chủ xong và kiểm bằng `curl` trước, rồi mới làm giao diện.

## 9. Kiểm trước khi bàn giao

Cổng tự động (CLAUDE.md):

```
npm run typecheck && npm test
cd web && npm run typecheck && npm run lint && npx vitest run src/modules/settings
docker compose up -d --build app
```

Kiểm tay trên `http://localhost:8090/app/settings`:

1. Màn mở được, các ô hiện đúng nguồn (`.env` / mặc định), ô bí mật không lộ giá trị (xem cả tab Network của
   trình duyệt: phản hồi `GET /api/settings` không có khóa).
2. Đổi `assistant_max_per_hour` 30 → 40 → Lưu → tải lại trang vẫn 40, nhãn «đặt trên web»; «Khôi phục mặc định»
   → về 30, nhãn «từ .env».
3. Nhập 5000 vào `assistant_max_per_hour` → báo lỗi, không lưu; nhập tên mô hình có dấu cách → báo lỗi.
4. Đổi `gemini_model` sang một tên sai (vd `khong-co-model`) → nhắn bot một câu → log báo lỗi mô hình (chứng tỏ
   đã nạp lại); đổi lại tên đúng → bot trả lời. **Không khởi động lại container** giữa các bước.
5. Xóa khóa Gemini trên web (khi `.env` cũng trống) → bot thôi trả lời, tin vẫn lưu; dán lại → trả lời lại.
6. Google: dán JSON khóa của một service account thử + link một trang tính CHƯA chia sẻ → «Kiểm tra» báo câu
   «chưa chia sẻ cho …»; chia sẻ xong bấm lại → có dòng mới trong tab «Bot trợ lý».
7. Tab Lịch sử thay đổi có đủ các lần lưu / khôi phục / kiểm tra; dòng đổi khóa chỉ ghi nhãn.
8. `docker compose logs app` không có giá trị khóa nào (tìm thử 8 ký tự đầu của khóa Gemini và chữ
   `PRIVATE KEY`).

## 10. Bẫy đã gặp trong kho này

- **Không in / đọc bí mật vào chat, log, ảnh chụp.** Script cần mật khẩu quản trị thì tự đọc `.env` (xem
  `scratch/shot.mjs` trên máy đại ca).
- Viết script bằng heredoc trong Git Bash làm **mất dấu `\`** (`\n`, `\d` hỏng) — viết tệp rồi chạy.
- `web/`: React 19, TypeScript **ghim 5.9.3** (đừng nâng), không thêm barrel `index.ts`, khóa query để ở
  `query-keys.ts`, class Tailwind ghép bằng `cn()`, không emoji, tên hàm / biến tiếng Anh, chữ hiện ra và chú thích
  tiếng Việt.
- Test giao diện chạy **theo thư mục** (`npx vitest run src/modules/settings`), không chạy cả cây.
- Mã trạng thái / loại lưu SMALLINT ở `src/constants.ts` — phase này không cần mã mới.
- Nhánh: làm trên nhánh riêng tách từ `dev1` (vd `phase-b-cai-dat`), xong mở PR vào `dev1`; **không** đẩy thẳng
  `dev` / `main`.
- Đăng nhập Zalo Web bằng tài khoản bot là bot bị đá — đừng làm khi thử.

## 11. Sau phase B

- Phase G dùng `GoogleSheetsClient.appendRows` để xuất báo cáo; phase D / G thêm khóa «giờ gửi bản tin», «ngưỡng
  chưa trả lời (giờ)», «giờ làm việc» vào registry — giao diện tự có ô, không phải viết thêm màn.
- Cập nhật `doc/03-mo-ta-chuc-nang.md`: mục 2 thêm dòng màn **Cài đặt**, mục 7 đánh dấu phase B **Xong**.
