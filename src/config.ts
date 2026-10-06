// Đọc cấu hình từ biến môi trường một lần, kiểm ngay lúc khởi động — thiếu thì dừng sớm,
// đừng để chạy nửa chừng mới nổ.

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} phải là số nguyên, đang là "${raw}"`);
  return value;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

// Màu chủ đạo của giao diện — chèn thẳng vào CSS nên chỉ nhận mã màu #rrggbb
// Giao diện web giữ phiên Zalo + tin nhắn riêng tư: mật khẩu ngắn là cửa mở toang
const MIN_ADMIN_PASSWORD_LENGTH = 12;

function readAdminPassword(): string {
  const value = readString("ADMIN_PASSWORD");
  if (value.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD phải dài ít nhất ${MIN_ADMIN_PASSWORD_LENGTH} ký tự`);
  }
  return value;
}

export type StorageDriver = "local" | "r2";

export interface AppConfig {
  databaseUrl: string;
  sessionEncryptionKey: string;
  dataDir: string;
  storageDriver: StorageDriver;
  r2: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; prefix: string };
  defaultGroupRead: boolean;
  defaultGroupCaptureFiles: boolean;
  maxFileBytes: number;
  downloadConcurrency: number;
  heartbeatSeconds: number;
  web: { host: string; port: number; adminPassword: string; cookieSecure: boolean; trustCloudflareIp: boolean; spaDistDir: string };
  defaultDirectRead: boolean;
  /** Số tin gần nhất xin Zalo khi lấy tin cũ của một nhóm. */
  defaultDirectCaptureFiles: boolean;
  /** Không có GEMINI_API_KEY thì trợ lý tắt: bot vẫn lưu tin, không trả lời ai. */
  assistant: {
    apiKey: string; model: string; heavyModel: string; fallbackModels: string[]; maxPerHour: number; dailyTokenCap: number;
    sendIntervalMs: number; maxReadFileBytes: number;
    /** Trả lời trong nhóm khi được gọi (@nhắc bot hoặc từ khóa). Chỉ đặt trên màn Cài đặt. */
    groupReplyEnabled: boolean; groupTriggerKeywords: string[];
    /** Trong nhóm: mọi thành viên gọi được bot (true) hay chỉ người có vai trò (false). Tin riêng luôn cần vai trò. */
    groupReplyAnyone: boolean;
    /** Đuôi tệp bot được đọc (cài đặt «Loại tệp bot được đọc»). Rỗng = mọi loại đọc được. */
    readableFileTypes: string[];
    /** Gắn dòng đo token dưới mỗi câu trả lời (thử mô hình / ước chi phí). */
    showTokenUsage: boolean;
  };
  /** Chỉ đặt được trên màn Cài đặt (bảng app_setting) — không có biến .env. */
  google: {
    serviceAccount: unknown; spreadsheetUrl: string;
    /** OAuth client (Kết nối Google: chép Client ID + Client secret từ Google Cloud) + tài khoản đã kết nối — để tạo cuộc họp Meet. */
    oauthClientId: string;
    oauthClientSecret: string;
    calendarAccount: { email: string; refresh_token: string } | null;
  };
}

export function loadConfig(): AppConfig {
  const storageDriver = readString("STORAGE_DRIVER", "local");
  if (storageDriver !== "local" && storageDriver !== "r2") {
    throw new Error(`STORAGE_DRIVER chỉ nhận local | r2, đang là "${storageDriver}"`);
  }
  return {
    databaseUrl: readString("DATABASE_URL"),
    sessionEncryptionKey: readString("SESSION_ENCRYPTION_KEY"),
    dataDir: readString("DATA_DIR", "./data"),
    storageDriver,
    r2: {
      // R2_ENDPOINT đầy đủ (vd https://<account>.r2.cloudflarestorage.com), hoặc chỉ R2_ACCOUNT_ID
      endpoint: process.env.R2_ENDPOINT?.trim()
        || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : ""),
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      bucket: process.env.R2_BUCKET ?? "",
      prefix: process.env.R2_PREFIX ?? "bot-tro-ly/",
    },
    // Mặc định KHÔNG đọc nhóm mới: ai cũng thêm được bot vào nhóm bất kỳ
    defaultGroupRead: readBool("DEFAULT_GROUP_READ", false),
    defaultGroupCaptureFiles: readBool("DEFAULT_GROUP_CAPTURE_FILES", false),
    maxFileBytes: readInt("MAX_FILE_MB", 100) * 1024 * 1024,
    downloadConcurrency: readInt("DOWNLOAD_CONCURRENCY", 3),
    heartbeatSeconds: readInt("HEARTBEAT_SECONDS", 60),
    web: {
      // Mặc định chỉ nghe trong máy — vào từ xa thì qua đường hầm (SSH / Cloudflare Access)
      host: readString("WEB_HOST", "127.0.0.1"),
      port: readInt("WEB_PORT", 8090),
      adminPassword: readAdminPassword(),
      // Bật khi chạy sau HTTPS để cookie phiên không bao giờ đi qua http thường
      cookieSecure: readBool("COOKIE_SECURE", false),
      // Chỉ bật khi CHẮC CHẮN đứng sau Cloudflare — không thì ai cũng tự gửi tiêu đề này để né khóa đăng nhập
      trustCloudflareIp: readBool("TRUST_CLOUDFLARE_IP", false),
      // Bản build của giao diện mới (web/dist) — phục vụ dưới /app
      spaDistDir: readString("WEB_DIST_DIR", "web/dist"),
    },
    // Người ta chủ động nhắn riêng cho bot nên mặc định LƯU (khác nhóm: mặc định không đọc)
    defaultDirectRead: readBool("DEFAULT_DM_READ", true),
    defaultDirectCaptureFiles: readBool("DEFAULT_DM_CAPTURE_FILES", true),
    assistant: {
      apiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
      // Dòng lite: đo thật 01/10/2026 nhanh gấp ~10 lần bản Flash (1 giây so với 11 giây), tóm tắt vẫn đúng
      model: readString("GEMINI_MODEL", "gemini-3.5-flash-lite"),
      // Lượt nặng (tóm tắt dài, đọc tệp / ảnh) đi bản này; để trống = dùng GEMINI_MODEL cho mọi việc
      heavyModel: readString("GEMINI_MODEL_HEAVY", "gemini-3.5-flash"),
      // Mô hình chính quá tải (503) thì chuyển lần lượt sang các mô hình này
      fallbackModels: readString("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-flash-latest").split(",").map((name) => name.trim()).filter(Boolean),
      maxPerHour: readInt("ASSISTANT_MAX_PER_HOUR", 30),
      dailyTokenCap: readInt("ASSISTANT_DAILY_TOKEN_CAP", 3_000_000),
      // Giãn cách giữa hai tin bot gửi — gửi dồn dập là cách nhanh nhất để Zalo khóa tài khoản
      sendIntervalMs: readInt("ASSISTANT_SEND_INTERVAL_MS", 1500),
      // Tệp lớn hơn thì bot từ chối đọc (chốt 01/10/2026: 5 MB; ảnh cũng đọc)
      maxReadFileBytes: readInt("ASSISTANT_MAX_READ_FILE_MB", 5) * 1024 * 1024,
      groupReplyEnabled: true,
      groupTriggerKeywords: ["bot", "bot ơi", "trợ lý ơi", "@bot"],
      groupReplyAnyone: true,
      showTokenUsage: false,
      readableFileTypes: ["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "jpg", "jpeg", "png", "webp", "mp3", "m4a", "wav", "aac"],
    },
    google: { serviceAccount: null, spreadsheetUrl: "", oauthClientId: "", oauthClientSecret: "", calendarAccount: null },
  };
}
