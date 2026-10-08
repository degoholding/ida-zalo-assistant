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
  /**
   * Việc nền (dọn tin quá hạn, tải ảnh đại diện, việc theo lịch) chạy NGAY trong tiến trình chính (true — máy dev, cài
   * một khối) hay ở tiến trình `worker` riêng (false — docker compose bật service worker). 08/10/2026.
   */
  workerEmbedded: boolean;
  web: { host: string; port: number; cookieSecure: boolean; trustCloudflareIp: boolean; spaDistDir: string };
  defaultDirectRead: boolean;
  /** Số tin gần nhất xin Zalo khi lấy tin cũ của một nhóm. */
  defaultDirectCaptureFiles: boolean;
  /** Không có GEMINI_API_KEY thì trợ lý tắt: bot vẫn lưu tin, không trả lời ai. */
  assistant: {
    apiKey: string;
    /** Khóa OpenAI (mô hình «gpt-…», «o3…») — 07/10/2026. Trống = chỉ dùng được mô hình Gemini. */
    openaiApiKey: string;
    /** Địa chỉ API kiểu OpenAI — khóa mua qua bên bán lại (proxy) thì dùng địa chỉ của họ. */
    openaiBaseUrl: string;
    /** Nhà cung cấp AI: gemini / openai / ưu tiên openai rồi lùi về gemini khi lỗi. */
    provider: "gemini" | "openai" | "openai_then_gemini";
    openaiModel: string; openaiHeavyModel: string; openaiFallbackModels: string[];
    model: string; heavyModel: string; fallbackModels: string[]; maxPerHour: number; dailyTokenCap: number;
    sendIntervalMs: number; maxReadFileBytes: number;
    /** Số câu hỏi trả lời song song tối đa (cả mọi tài khoản bot); câu dư xếp hàng. */
    concurrency: number;
    /** Trần token mỗi ngày của MỘT tài khoản bot (giờ VN); 0 = không giới hạn riêng, chỉ theo trần cả hệ thống. */
    dailyTokenCapPerBot: number;
    /** Trả lời trong nhóm khi được gọi (@nhắc bot hoặc từ khóa). Chỉ đặt trên màn Cài đặt. */
    groupReplyEnabled: boolean; groupTriggerKeywords: string[];
    /** Trong nhóm: mọi thành viên gọi được bot (true) hay chỉ người có vai trò (false). Tin riêng luôn cần vai trò. */
    groupReplyAnyone: boolean;
    /** Đuôi tệp bot được đọc (cài đặt «Loại tệp bot được đọc»). Rỗng = mọi loại đọc được. */
    readableFileTypes: string[];
    /** Gắn dòng đo token dưới mỗi câu trả lời (thử mô hình / ước chi phí). */
    showTokenUsage: boolean;
  };
  /** Lịch làm việc (giờ VN) — chuỗi như nhập trên màn Cài đặt; dựng lịch bằng buildWorkCalendar. */
  calendar: { workHours: string; workDays: string[]; quietHours: string; holidays: string };
  /** Bảo vệ dữ liệu trước khi gửi sang AI (phase 3, bước 3.3). */
  privacy: {
    /** Che SĐT / số tài khoản / CCCD trong dữ liệu đưa cho mô hình. */
    maskPersonalData: boolean;
    /** Câu hỏi kỹ thuật thuốc BVTV: tắt tìm web, chỉ trích tài liệu đã duyệt (IDA câu 13). */
    blockWebForAgroTechnical: boolean;
    /** Hãng AI được phép (mã AiKeyProvider dạng chuỗi). Khóa hãng ngoài danh sách bị bỏ qua. */
    allowedAiProviders: string[];
  };
  /** Sao lưu CSDL: số ngày giữ bản sao lưu trên kho tệp. */
  backup: { keepDays: number };
  /** Chỉ đặt được trên màn Cài đặt (bảng app_setting) — không có biến .env. */
  google: {
    serviceAccount: unknown; spreadsheetUrl: string;
    /** OAuth client (Kết nối Google: chép Client ID + Client secret từ Google Cloud) + tài khoản đã kết nối — để tạo cuộc họp Meet. */
    oauthClientId: string;
    /** Client ID của nút «Đăng nhập bằng Google» (Google Identity Services) — phase 4. */
    loginClientId: string;
    oauthClientSecret: string;
    calendarAccount: { email: string; refresh_token: string } | null;
  };
}

// Lịch IDA chốt 07/10/2026 (Q&A câu 7): giờ làm 08:30–12:00, 13:30–17:30, thứ 2 – thứ 7; yên lặng 21:00–06:30
export const DEFAULT_WORK_HOURS = "08:30-12:00, 13:30-17:30";
export const DEFAULT_WORK_DAYS = ["1", "2", "3", "4", "5", "6"];
export const DEFAULT_QUIET_HOURS = "21:00-06:30";
// Lễ dương lịch cố định; Tết âm lịch mỗi năm một khác — quản trị thêm khoảng ngày (vd 05/02/2027-11/02/2027)
export const DEFAULT_HOLIDAYS = "01/01, 30/04, 01/05, 02/09";
/** Mã mọi hãng AI (AiKeyProvider) — mặc định cho phép hết, quản trị bỏ bớt ở màn Cài đặt. */
export const ALL_AI_PROVIDER_CODES = ["1", "2", "3", "4", "5", "6"];

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
    workerEmbedded: readBool("WORKER_EMBEDDED", true),
    web: {
      // Mặc định chỉ nghe trong máy — vào từ xa thì qua đường hầm (SSH / Cloudflare Access)
      host: readString("WEB_HOST", "127.0.0.1"),
      port: readInt("WEB_PORT", 8090),
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
      openaiApiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
      openaiBaseUrl: readString("OPENAI_BASE_URL", "https://api.openai.com/v1"),
      provider: (["gemini", "openai", "openai_then_gemini"].includes(readString("AI_PROVIDER", "gemini")) ? readString("AI_PROVIDER", "gemini") : "gemini") as "gemini",
      openaiModel: readString("OPENAI_MODEL", "gpt-6-luna"),
      openaiHeavyModel: readString("OPENAI_MODEL_HEAVY", "gpt-6.1-sol"),
      openaiFallbackModels: readString("OPENAI_FALLBACK_MODELS", "gpt-6.1-sol").split(",").map((name) => name.trim()).filter(Boolean),
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
      concurrency: readInt("ASSISTANT_CONCURRENCY", 6),
      dailyTokenCapPerBot: readInt("ASSISTANT_DAILY_TOKEN_CAP_PER_BOT", 0),
      groupReplyEnabled: true,
      groupTriggerKeywords: ["bot", "bot ơi", "trợ lý ơi", "@bot"],
      groupReplyAnyone: true,
      showTokenUsage: false,
      readableFileTypes: ["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "jpg", "jpeg", "png", "webp", "mp3", "m4a", "wav", "aac"],
    },
    calendar: { workHours: DEFAULT_WORK_HOURS, workDays: DEFAULT_WORK_DAYS, quietHours: DEFAULT_QUIET_HOURS, holidays: DEFAULT_HOLIDAYS },
    privacy: { maskPersonalData: true, blockWebForAgroTechnical: true, allowedAiProviders: ALL_AI_PROVIDER_CODES },
    backup: { keepDays: readInt("BACKUP_KEEP_DAYS", 30) },
    google: { serviceAccount: null, spreadsheetUrl: "", oauthClientId: "", oauthClientSecret: "", calendarAccount: null, loginClientId: "" },
  };
}
