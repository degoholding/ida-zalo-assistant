import type { AppConfig } from "../config.js";
import type { GoogleAccountLink } from "../google/google-oauth.js";
import { parseDriveFolderId } from "../google/drive-error-messages.js";
import { parseServiceAccount, parseSpreadsheetId } from "../google/service-account.js";
import { ApiError } from "../web/api/api-http.js";
import { ALL_AI_PROVIDER_CODES, DEFAULT_HOLIDAYS, DEFAULT_IMPORTANT_KEYWORDS, DEFAULT_QUIET_HOURS, DEFAULT_STRICT_KEYWORDS, DEFAULT_URGENT_KEYWORDS, DEFAULT_WORK_DAYS, DEFAULT_WORK_HOURS } from "../config.js";
import { CalendarInputError, parseHolidays, parseTimeRanges, parseWorkDays } from "../schedule/work-calendar.js";

// Danh mục cài đặt sửa được trên màn Cài đặt — khai MỘT chỗ ở đây. Thêm khóa = thêm một dòng vào mảng;
// API, kho lưu và giao diện tự có ô. Thứ tự ưu tiên: giá trị trên web (app_setting) > .env > mặc định.
// Những thứ cần có trước khi vào được DB / web (DATABASE_URL, khóa mã hóa, mật khẩu, cổng…) KHÔNG đưa lên đây.

export type SettingGroup = "assistant" | "sync" | "google" | "operations";
export type SettingType = "string" | "int" | "bool" | "list" | "json";
export type SettingValue = string | number | boolean | string[] | Record<string, unknown> | null;

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  label: string;
  help: string;
  type: SettingType;
  /** Biến .env tương ứng (null = chỉ đặt được trên web). */
  envName: string | null;
  defaultValue: SettingValue;
  secret: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  /** Câu báo khi không khớp `pattern`. */
  patternHint?: string;
  maxLength?: number;
  /** Chuỗi / danh sách được để trống. */
  allowEmpty?: boolean;
  /** Danh sách: tối đa ngần này phần tử. */
  maxItems?: number;
  /** Không hiện ở màn Cài đặt, không sửa qua PATCH — chỉ máy chủ ghi (vd refresh token sau «Kết nối Google»). */
  hidden?: boolean;
  /** Lựa chọn sẵn — danh sách: ô tick theo nhóm; chuỗi: ô chọn một giá trị. Có thì chỉ nhận giá trị trong đây. */
  choices?: { value: string; label: string; group: string }[];
  /** Kiểm thêm + chuẩn hóa sau khi ép kiểu (vd JSON service account). */
  normalize?: (value: SettingValue) => SettingValue;
  /** Phủ giá trị đang hiệu lực lên AppConfig (vd MB → byte). */
  applyTo: (config: AppConfig, value: SettingValue) => void;
}

const MB = 1024 * 1024;

/** Kiểm chuỗi lịch bằng hàm parse của lịch làm việc; sai thì báo 422 với câu của bộ parse. */
function calendarCheck(check: (value: SettingValue) => unknown): (value: SettingValue) => SettingValue {
  return (value) => {
    try {
      check(value);
    } catch (error) {
      if (error instanceof CalendarInputError) throw new ApiError(422, "validation_error", error.message);
      throw error;
    }
    return value;
  };
}

const WEEKDAY_CHOICES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]
  .map((label, index) => ({ value: String(index + 1), label, group: "Ngày làm việc" }));

/** Mã AiKeyProvider (src/constants.ts) — cùng thứ tự với ALL_AI_PROVIDER_CODES. */
const ALLOWED_AI_PROVIDER_CHOICES = [
  { value: "1", label: "Gemini (Google)", group: "Hãng chính thức" },
  { value: "2", label: "OpenAI", group: "Hãng chính thức" },
  { value: "4", label: "DeepSeek", group: "Hãng chính thức" },
  { value: "5", label: "Grok (xAI)", group: "Hãng chính thức" },
  { value: "6", label: "OpenRouter", group: "Trạm trung gian" },
  { value: "3", label: "Tương thích OpenAI (trạm tự nhập, vd modelapi.vn)", group: "Trạm trung gian" },
];
const MODEL_PATTERN = /^[a-z0-9.-]{3,80}$/;
const MODEL_HINT = "tên mô hình chỉ gồm chữ thường, số, dấu chấm, gạch ngang (3–80 ký tự)";

const asString = (value: SettingValue) => (typeof value === "string" ? value : "");
const asNumber = (value: SettingValue) => Number(value);
const asList = (value: SettingValue) => (Array.isArray(value) ? value : []);

/** Loại tệp bot đọc / nghe được — mỗi mục một ô tick ở màn Cài đặt. Video không có ở đây: bot không đọc video. */
const READABLE_FILE_CHOICES = [
  ...["pdf", "docx", "txt", "md", "csv"].map((value) => ({ value, label: value, group: "Văn bản" })),
  ...["xlsx", "xls"].map((value) => ({ value, label: value, group: "Bảng tính" })),
  ...["jpg", "jpeg", "png", "webp", "gif"].map((value) => ({ value, label: value, group: "Ảnh" })),
  ...["mp3", "m4a", "wav", "aac", "ogg"].map((value) => ({ value, label: value, group: "Ghi âm (gỡ băng + tóm tắt)" })),
];

/** Chuẩn hóa đuôi tệp («.MP3» → «mp3»), bỏ trùng, và chỉ nhận đuôi có trong danh sách chọn. */
function normalizeFileTypes(value: SettingValue): SettingValue {
  const allowed = new Set(READABLE_FILE_CHOICES.map((choice) => choice.value));
  const types = [...new Set(asList(value).map((ext) => ext.replace(/^\./, "").toLowerCase()))];
  const unknown = types.filter((ext) => !allowed.has(ext));
  if (unknown.length) throw new ApiError(422, "validation_error", `«${unknown.join(", ")}» không có trong danh sách loại tệp bot đọc được`);
  return types;
}

/** Nhà cung cấp AI (07/10/2026) — chọn một bên, hoặc ưu tiên OpenAI và tự lùi về Gemini khi OpenAI lỗi. */
export const AI_PROVIDER_CHOICES = [
  { value: "gemini", label: "Gemini (Google)", group: "" },
  { value: "openai", label: "OpenAI (Codex / GPT) — tắt Gemini", group: "" },
  { value: "openai_then_gemini", label: "Ưu tiên OpenAI, lỗi thì dùng Gemini", group: "" },
];

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "ai_provider", group: "assistant", label: "Nhà cung cấp AI", type: "string", secret: false,
    help: "Bot dùng AI của ai. «Ưu tiên OpenAI…»: trả lời bằng GPT, OpenAI lỗi (khóa sai, hết tiền, quá tải) thì tự chuyển sang Gemini — bot không bị chết.",
    envName: "AI_PROVIDER", defaultValue: "gemini", choices: AI_PROVIDER_CHOICES,
    applyTo: (config, value) => { config.assistant.provider = (asString(value) || "gemini") as AppConfig["assistant"]["provider"]; },
  },
  {
    key: "gemini_api_key", group: "assistant", label: "Khóa Gemini", type: "string", secret: true,
    help: "Khóa API Google Gemini (nghe ghi âm dài, tìm Google). Thiếu khóa của nhà cung cấp đang chọn = trợ lý tắt: bot vẫn lưu tin, không trả lời ai.",
    envName: "GEMINI_API_KEY", defaultValue: "", maxLength: 200, pattern: /^\S+$/, patternHint: "khóa không được có khoảng trắng",
    applyTo: (config, value) => { config.assistant.apiKey = asString(value).trim(); },
  },
  {
    key: "openai_api_key", group: "assistant", label: "Khóa OpenAI", type: "string", secret: true,
    help: "Khóa API OpenAI (tạo ở platform.openai.com → API keys, thường bắt đầu «sk-proj-»). Dùng khi «Nhà cung cấp AI» là OpenAI.",
    envName: "OPENAI_API_KEY", defaultValue: "", maxLength: 300, pattern: /^\S+$/, patternHint: "khóa không được có khoảng trắng",
    applyTo: (config, value) => { config.assistant.openaiApiKey = asString(value).trim(); },
  },
  {
    key: "assistant_tavily_api_key", group: "assistant", label: "Khóa Tavily (tìm web)", type: "string", secret: true,
    help: "Tìm web riêng cho trợ lý (giá vàng, tỷ giá, tin tức, báo cáo công ty…) — tạo khóa ở app.tavily.com (bắt đầu «tvly-»). " +
      "Có khóa thì tìm bằng Tavily, mô hình đang dùng (DeepSeek…) đọc kết quả; lỗi / hết hạn mức thì lùi về tìm Google của Gemini nếu khóa Gemini còn tiền.",
    envName: "TAVILY_API_KEY", defaultValue: "", maxLength: 200, pattern: /^\S+$/, patternHint: "khóa không được có khoảng trắng",
    applyTo: (config, value) => { config.assistant.tavilyApiKey = asString(value).trim(); },
  },
  {
    key: "openai_model", group: "assistant", label: "OpenAI — mô hình chính", type: "string", secret: false,
    help: "Mô hình GPT trả lời câu hỏi thường ngày, vd gpt-6-luna (rẻ nhất).",
    envName: "OPENAI_MODEL", defaultValue: "gpt-6-luna", pattern: MODEL_PATTERN, patternHint: MODEL_HINT,
    applyTo: (config, value) => { config.assistant.openaiModel = asString(value); },
  },
  {
    key: "openai_model_heavy", group: "assistant", label: "OpenAI — mô hình việc nặng", type: "string", secret: false,
    help: "Tóm tắt dài, đọc tệp / ảnh / link, recap, xuất PDF, vd gpt-6.1-sol. Để trống = dùng mô hình chính.",
    envName: "OPENAI_MODEL_HEAVY", defaultValue: "gpt-6.1-sol", pattern: MODEL_PATTERN, patternHint: MODEL_HINT, allowEmpty: true,
    applyTo: (config, value) => { config.assistant.openaiHeavyModel = asString(value); },
  },
  {
    key: "openai_fallback_models", group: "assistant", label: "OpenAI — mô hình dự phòng", type: "list", secret: false,
    help: "Mô hình GPT chính quá tải / hết hạn mức thì chuyển lần lượt sang các mô hình này (cách nhau dấu phẩy).",
    envName: "OPENAI_FALLBACK_MODELS", defaultValue: ["gpt-6.1-sol"], pattern: MODEL_PATTERN, patternHint: MODEL_HINT, maxItems: 5, allowEmpty: true,
    applyTo: (config, value) => { config.assistant.openaiFallbackModels = asList(value); },
  },
  {
    key: "openai_base_url", group: "assistant", label: "Địa chỉ API OpenAI", type: "string", secret: false,
    help: "Mặc định https://api.openai.com/v1 (khóa mua trực tiếp ở platform.openai.com). Khóa mua qua bên bán lại / proxy thì dán địa chỉ API họ đưa (thường kết thúc bằng /v1).",
    envName: "OPENAI_BASE_URL", defaultValue: "https://api.openai.com/v1", maxLength: 300, pattern: /^https?:\/\/\S+$/, patternHint: "địa chỉ bắt đầu bằng http:// hoặc https://",
    applyTo: (config, value) => { config.assistant.openaiBaseUrl = asString(value).trim().replace(/\/+$/, ""); },
  },
  {
    key: "gemini_model", group: "assistant", label: "Gemini — mô hình chính", type: "string", secret: false,
    help: "Mô hình Gemini trả lời câu hỏi thường ngày.",
    envName: "GEMINI_MODEL", defaultValue: "gemini-3.5-flash-lite", pattern: MODEL_PATTERN, patternHint: MODEL_HINT,
    applyTo: (config, value) => { config.assistant.model = asString(value); },
  },
  {
    key: "gemini_model_heavy", group: "assistant", label: "Gemini — mô hình việc nặng", type: "string", secret: false,
    help: "Tóm tắt dài, đọc tệp / ảnh / link đi mô hình này. Để trống = dùng mô hình chính.",
    envName: "GEMINI_MODEL_HEAVY", defaultValue: "gemini-3.5-flash", pattern: MODEL_PATTERN, patternHint: MODEL_HINT, allowEmpty: true,
    applyTo: (config, value) => { config.assistant.heavyModel = asString(value); },
  },
  {
    key: "gemini_fallback_models", group: "assistant", label: "Gemini — mô hình dự phòng", type: "list", secret: false,
    help: "Mô hình chính quá tải / hết hạn mức thì chuyển lần lượt sang các mô hình này (cách nhau dấu phẩy).",
    envName: "GEMINI_FALLBACK_MODELS", defaultValue: ["gemini-3.5-flash", "gemini-flash-latest"],
    pattern: MODEL_PATTERN, patternHint: MODEL_HINT, maxItems: 5, allowEmpty: true,
    applyTo: (config, value) => { config.assistant.fallbackModels = asList(value); },
  },
  {
    key: "assistant_max_per_hour", group: "assistant", label: "Số câu hỏi / người / giờ", type: "int", secret: false,
    help: "Mỗi người hỏi tối đa bấy nhiêu câu trong một giờ.",
    envName: "ASSISTANT_MAX_PER_HOUR", defaultValue: 30, min: 1, max: 1000,
    applyTo: (config, value) => { config.assistant.maxPerHour = asNumber(value); },
  },
  {
    key: "assistant_daily_token_cap", group: "assistant", label: "Trần token mỗi ngày", type: "int", secret: false,
    help: "Trần token cả hệ thống mỗi ngày (giờ Việt Nam); chạm trần thì nghỉ tới hôm sau.",
    envName: "ASSISTANT_DAILY_TOKEN_CAP", defaultValue: 3_000_000, min: 10_000, max: 100_000_000,
    applyTo: (config, value) => { config.assistant.dailyTokenCap = asNumber(value); },
  },
  {
    key: "assistant_max_read_file_mb", group: "assistant", label: "Cỡ tệp tối đa bot đọc (MB)", type: "int", secret: false,
    help: "Tệp lớn hơn thì bot từ chối đọc. Ghi âm cuộc họp: ~1 MB mỗi phút mp3 — họp 1 giờ cần ~60 MB (tệp > 14 MB được tải lên Gemini Files API).",
    envName: "ASSISTANT_MAX_READ_FILE_MB", defaultValue: 5, min: 1, max: 200,
    applyTo: (config, value) => { config.assistant.maxReadFileBytes = asNumber(value) * MB; },
  },
  {
    key: "assistant_readable_file_types", group: "assistant", label: "Loại tệp bot được đọc", type: "list", secret: false,
    help: "Tick loại tệp bot được đọc / nghe. Ghi âm thì bot gỡ băng + tóm tắt. Video (mp4…) không đọc. Bỏ tick hết = mọi loại bot đọc được.",
    envName: null, defaultValue: ["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "jpg", "jpeg", "png", "webp", "mp3", "m4a", "wav", "aac"],
    maxItems: 40, allowEmpty: true, pattern: /^\.?[A-Za-z0-9]{1,10}$/, patternHint: "mỗi mục là đuôi tệp 1–10 chữ / số, vd pdf hoặc .mp3",
    choices: READABLE_FILE_CHOICES,
    normalize: normalizeFileTypes,
    applyTo: (config, value) => { config.assistant.readableFileTypes = asList(value); },
  },
  {
    key: "assistant_show_token_usage", group: "assistant", label: "Hiện số token dưới câu trả lời", type: "bool", secret: false,
    help: "Bật thì mỗi câu trả lời kèm tổng token làm tròn nghìn, vd «[3k token]» — để thử mô hình, ước chi phí. Chi tiết từng lượt xem ở bảng assistant_turn. Chạy thật thì nên tắt.",
    envName: null, defaultValue: false,
    applyTo: (config, value) => { config.assistant.showTokenUsage = value === true; },
  },
  {
    key: "assistant_concurrency", group: "assistant", label: "Số câu trả lời chạy cùng lúc", type: "int", secret: false,
    help: "Nhiều người cùng hỏi thì bot trả lời song song tối đa bấy nhiêu câu, câu dư xếp hàng (vẫn được trả lời, chỉ chờ lâu hơn). Cao quá dễ chạm giới hạn của hãng AI.",
    envName: "ASSISTANT_CONCURRENCY", defaultValue: 6, min: 1, max: 30,
    applyTo: (config, value) => { config.assistant.concurrency = asNumber(value); },
  },
  {
    key: "assistant_daily_token_cap_per_bot", group: "assistant", label: "Trần token mỗi ngày cho một bot", type: "int", secret: false,
    help: "Mỗi tài khoản bot dùng tối đa bấy nhiêu token mỗi ngày (giờ Việt Nam); chạm trần thì bot đó nghỉ tới hôm sau. 0 = không giới hạn riêng, chỉ theo trần cả hệ thống.",
    envName: "ASSISTANT_DAILY_TOKEN_CAP_PER_BOT", defaultValue: 0, min: 0, max: 100_000_000,
    applyTo: (config, value) => { config.assistant.dailyTokenCapPerBot = asNumber(value); },
  },
  {
    key: "privacy_mask_personal_data", group: "assistant", label: "Che dữ liệu cá nhân trước khi gửi AI", type: "bool", secret: false,
    help: "Bật thì số điện thoại, số tài khoản, số CCCD trong tin nhắn / tệp bị che (chỉ giữ 3 số cuối) trước khi đưa cho mô hình AI. Tệp PDF / ảnh / ghi âm gửi nguyên cho mô hình đọc nên KHÔNG che được.",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.privacy.maskPersonalData = value === true; },
  },
  {
    key: "privacy_block_web_agro_technical", group: "assistant", label: "Câu hỏi kỹ thuật thuốc BVTV: không tìm web", type: "bool", secret: false,
    help: "Bật thì câu hỏi về liều lượng, pha trộn, phun thuốc, sâu bệnh… bot không tìm trên mạng — chỉ trích tài liệu đã duyệt, luôn kèm «cần kỹ thuật xác nhận» (IDA câu 13).",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.privacy.blockWebForAgroTechnical = value === true; },
  },
  {
    key: "privacy_allowed_ai_providers", group: "assistant", label: "Hãng AI được phép dùng", type: "list", secret: false,
    help: "Khóa AI của hãng không được tick thì bot bỏ qua (dữ liệu không đi tới hãng đó). Trạm trung gian là bên thứ ba chuyển tiếp yêu cầu — không rõ dữ liệu đi đâu tiếp.",
    envName: null, defaultValue: ALL_AI_PROVIDER_CODES, choices: ALLOWED_AI_PROVIDER_CHOICES, maxItems: 10,
    normalize: (value) => { if (!asList(value).length) throw new ApiError(422, "validation_error", "phải chọn ít nhất một hãng"); return value; },
    applyTo: (config, value) => { config.privacy.allowedAiProviders = asList(value); },
  },
  {
    key: "assistant_send_interval_ms", group: "assistant", label: "Giãn cách gửi tin (mili giây)", type: "int", secret: false,
    help: "Khoảng nghỉ giữa hai tin bot gửi. Dưới 500 dễ bị Zalo khóa tài khoản.",
    envName: "ASSISTANT_SEND_INTERVAL_MS", defaultValue: 1500, min: 500, max: 10_000,
    applyTo: (config, value) => { config.assistant.sendIntervalMs = asNumber(value); },
  },
  {
    key: "group_reply_enabled", group: "assistant", label: "Trả lời trong nhóm khi được gọi", type: "bool", secret: false,
    help: "Bật thì bot trả lời trong nhóm khi được @nhắc tên hoặc có từ khóa gọi bot — chỉ với người có vai trò, chỉ dùng dữ liệu của chính nhóm đó. Mọi thành viên nhóm đều đọc được câu trả lời.",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.assistant.groupReplyEnabled = value === true; },
  },
  {
    key: "group_reply_anyone", group: "assistant", label: "Trong nhóm: nhân sự gọi được bot", type: "bool", secret: false,
    help: "Bật: người có loại «Nhân sự» (Danh bạ) gọi được bot trong nhóm đang «Đọc tin» — bot chỉ dùng dữ liệu của chính nhóm đó. Tắt: chỉ người có vai trò (Quản lý / Trưởng phòng). Khách hàng và người chưa phân loại KHÔNG BAO GIỜ gọi được bot — bot im lặng. Tin nhắn riêng luôn cần vai trò.",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.assistant.groupReplyAnyone = value === true; },
  },
  {
    key: "group_trigger_keywords", group: "assistant", label: "Từ khóa gọi bot trong nhóm", type: "list", secret: false,
    help: "Tin nhóm có một trong các cụm này là gọi bot (không phân biệt dấu / hoa thường, phải nguyên cụm). Khớp ở bất kỳ chỗ nào trong tin nhưng phải nguyên chữ («robot», «chatbot» không tính). Để trống = chỉ @nhắc tên mới gọi được.",
    envName: null, defaultValue: ["bot", "bot ơi", "trợ lý ơi", "@bot"], maxItems: 10, allowEmpty: true,
    pattern: /^[^\n]{2,40}$/, patternHint: "mỗi từ khóa 2–40 ký tự",
    applyTo: (config, value) => { config.assistant.groupTriggerKeywords = asList(value); },
  },
  {
    key: "default_group_read", group: "sync", label: "Nhóm mới: đọc tin", type: "bool", secret: false,
    help: "Nhóm bot vừa vào có tự bật «Đọc tin» không. Áp dụng cho nhóm mới từ lúc lưu.",
    envName: "DEFAULT_GROUP_READ", defaultValue: false,
    applyTo: (config, value) => { config.defaultGroupRead = value === true; },
  },
  {
    key: "default_group_capture_files", group: "sync", label: "Nhóm mới: lấy tệp", type: "bool", secret: false,
    help: "Nhóm bot vừa vào có tự bật «Lấy tệp» không. Áp dụng cho nhóm mới từ lúc lưu.",
    envName: "DEFAULT_GROUP_CAPTURE_FILES", defaultValue: false,
    applyTo: (config, value) => { config.defaultGroupCaptureFiles = value === true; },
  },
  {
    key: "default_dm_read", group: "sync", label: "Cuộc riêng mới: lưu tin", type: "bool", secret: false,
    help: "Người lạ nhắn riêng cho bot thì có lưu tin không. Áp dụng cho cuộc riêng mới từ lúc lưu.",
    envName: "DEFAULT_DM_READ", defaultValue: true,
    applyTo: (config, value) => { config.defaultDirectRead = value === true; },
  },
  {
    key: "default_dm_capture_files", group: "sync", label: "Cuộc riêng mới: lấy tệp", type: "bool", secret: false,
    help: "Tệp gửi trong cuộc riêng mới có tải về kho không. Áp dụng cho cuộc riêng mới từ lúc lưu.",
    envName: "DEFAULT_DM_CAPTURE_FILES", defaultValue: true,
    applyTo: (config, value) => { config.defaultDirectCaptureFiles = value === true; },
  },
  {
    key: "max_file_mb", group: "sync", label: "Cỡ tệp tối đa tải về (MB)", type: "int", secret: false,
    help: "Tệp lớn hơn thì không tải về kho. Áp dụng cho tệp tải từ lúc lưu.",
    envName: "MAX_FILE_MB", defaultValue: 100, min: 1, max: 500,
    applyTo: (config, value) => { config.maxFileBytes = asNumber(value) * MB; },
  },
  {
    key: "google_service_account_json", group: "google", label: "Khóa service account", type: "json", secret: true,
    help: "Dán nguyên nội dung tệp .json tải từ Google Cloud Console (bước 4 trong hướng dẫn).",
    envName: null, defaultValue: null,
    normalize: (value) => parseServiceAccount(value) as unknown as Record<string, unknown>,
    applyTo: (config, value) => { config.google.serviceAccount = value; },
  },
  {
    key: "google_login_client_id", group: "google", label: "Client ID đăng nhập Google", type: "string", secret: false,
    help: "Client ID của nút «Đăng nhập bằng Google» ở màn đăng nhập (dùng chung với ERP được). Trong Google Cloud phải thêm địa chỉ trang quản trị (vd https://botida.degoholding.vn) vào «Authorized JavaScript origins». Để trống = tắt đăng nhập Google, chỉ còn mật khẩu quản trị.",
    envName: "GOOGLE_LOGIN_CLIENT_ID", defaultValue: "", allowEmpty: true, maxLength: 200,
    pattern: /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/, patternHint: "chỉ chép dòng Client ID, dạng …apps.googleusercontent.com",
    applyTo: (config, value) => { config.google.loginClientId = asString(value).trim(); },
  },
  {
    key: "google_oauth_client_id", group: "google", label: "Client ID (Kết nối Google)", type: "string", secret: false,
    help: "Chép dòng «Client ID» (…apps.googleusercontent.com) ở hộp thoại OAuth client của Google Cloud — để bot tạo cuộc họp Google Meet.",
    envName: null, defaultValue: "", allowEmpty: true, maxLength: 200,
    pattern: /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/, patternHint: "chỉ chép dòng Client ID, dạng …apps.googleusercontent.com",
    applyTo: (config, value) => { config.google.oauthClientId = asString(value).trim(); },
  },
  {
    key: "google_oauth_client_secret", group: "google", label: "Client secret (Kết nối Google)", type: "string", secret: true,
    help: "Chép dòng «Client secret» (GOCSPX-…) ở cùng hộp thoại. Lưu mã hóa, không hiện lại.",
    envName: null, defaultValue: "", maxLength: 200, pattern: /^\S+$/, patternHint: "client secret không có khoảng trắng",
    applyTo: (config, value) => { config.google.oauthClientSecret = asString(value).trim(); },
  },
  {
    key: "google_calendar_account", group: "google", label: "Tài khoản Google đã kết nối", type: "json", secret: true, hidden: true,
    help: "Refresh token sau «Kết nối Google» — máy chủ tự ghi.",
    envName: null, defaultValue: null,
    applyTo: (config, value) => { config.google.calendarAccount = (value as unknown as GoogleAccountLink | null) ?? null; },
  },
  // Recap họp tự động từ ghi âm trên Drive (phase 1, 10/10/2026) — đọc qua CHÍNH Gmail đã «Kết nối Google» phía
  // trên (quyền Drive tùy chọn), không phải service account; cần tick thêm quyền Drive lúc «Kết nối Google».
  {
    key: "meeting_auto_recap_enabled", group: "google", label: "Recap họp tự động từ Drive", type: "bool", secret: false,
    help: "Bật thì bot tự quét thư mục ghi âm mỗi 5 phút, khớp đúng cuộc họp đã đặt, gỡ băng và gửi recap PDF vào nhóm / người đặt họp.",
    envName: null, defaultValue: false,
    applyTo: (config, value) => { config.meetingRecap.enabled = value === true; },
  },
  {
    key: "google_drive_recording_folder", group: "google", label: "Thư mục ghi âm họp (Drive)", type: "string", secret: false,
    help: "Link (hoặc mã) thư mục «Ghi âm họp» trong Drive của Gmail đã «Kết nối Google» ở trên — bot chỉ đọc đúng thư mục này, không đụng tệp nào khác trong Drive.",
    envName: null, defaultValue: "", maxLength: 500, allowEmpty: true,
    normalize: (value) => { if (value) parseDriveFolderId(String(value)); return value; },
    applyTo: (config, value) => {
      const raw = asString(value);
      config.meetingRecap.folderId = raw ? parseDriveFolderId(raw) : "";
    },
  },
  {
    key: "meeting_auto_recap_max_mb", group: "google", label: "Trần ghi âm tự động recap (MB)", type: "int", secret: false,
    help: "Ghi âm lớn hơn mức này thì bot bỏ qua + báo, không recap tự động (tránh tốn token AI với tệp quá dài).",
    envName: null, defaultValue: 150, min: 10, max: 500,
    applyTo: (config, value) => { config.meetingRecap.maxBytes = asNumber(value) * MB; },
  },
  {
    key: "google_spreadsheet_url", group: "google", label: "Link trang tính", type: "string", secret: false,
    help: "Link Google Sheet bot ghi vào (đã chia sẻ quyền Người chỉnh sửa cho email service account).",
    envName: null, defaultValue: "", maxLength: 500, allowEmpty: true,
    normalize: (value) => { if (value) parseSpreadsheetId(String(value)); return value; },
    applyTo: (config, value) => { config.google.spreadsheetUrl = asString(value); },
  },
  {
    key: "work_hours", group: "operations", label: "Giờ làm việc", type: "string", secret: false,
    help: "Các khoảng giờ làm trong ngày, cách nhau dấu phẩy, vd «08:30-12:00, 13:30-17:30». Đồng hồ chờ trả lời chỉ chạy trong giờ này.",
    envName: null, defaultValue: DEFAULT_WORK_HOURS, maxLength: 100,
    normalize: calendarCheck((value) => parseTimeRanges(asString(value), false)),
    applyTo: (config, value) => { config.calendar.workHours = asString(value); },
  },
  {
    key: "work_days", group: "operations", label: "Ngày làm việc", type: "list", secret: false,
    help: "Ngày nào trong tuần là ngày làm việc. Ngày không tick = cả ngày tính là giờ yên lặng.",
    envName: null, defaultValue: DEFAULT_WORK_DAYS, choices: WEEKDAY_CHOICES, maxItems: 7,
    normalize: calendarCheck((value) => parseWorkDays(asList(value))),
    applyTo: (config, value) => { config.calendar.workDays = asList(value); },
  },
  {
    key: "quiet_hours", group: "operations", label: "Giờ yên lặng", type: "string", secret: false, allowEmpty: true,
    help: "Trong giờ này chỉ báo tin KHẨN / VIP, tin khác dồn vào bản tin sáng kế tiếp. Được vắt qua nửa đêm, vd «21:00-06:30».",
    envName: null, defaultValue: DEFAULT_QUIET_HOURS, maxLength: 100,
    normalize: calendarCheck((value) => parseTimeRanges(asString(value), true)),
    applyTo: (config, value) => { config.calendar.quietHours = asString(value); },
  },
  {
    key: "holidays", group: "operations", label: "Ngày nghỉ lễ / Tết", type: "string", secret: false, allowEmpty: true,
    help: "Ngày lặp hằng năm ghi dd/mm (vd 30/04); kỳ nghỉ một lần ghi dd/mm/yyyy-dd/mm/yyyy (vd Tết 05/02/2027-11/02/2027). Cách nhau dấu phẩy.",
    envName: null, defaultValue: DEFAULT_HOLIDAYS, maxLength: 1000,
    normalize: calendarCheck((value) => parseHolidays(asString(value))),
    applyTo: (config, value) => { config.calendar.holidays = asString(value); },
  },
  {
    key: "alert_enabled", group: "operations", label: "Bật cảnh báo tin nhắn", type: "bool", secret: false,
    help: "Bot tự phân loại tin trong các nhóm đang đọc, báo ngay tin KHẨN / VIP và nhắc tin chờ quá giờ vào chat riêng của người nhận (màn Người nhận).",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.alerts.enabled = value === true; },
  },
  {
    key: "alert_urgent_keywords", group: "operations", label: "Từ khóa KHẨN", type: "string", secret: false, allowEmpty: true,
    help: "Cách nhau dấu phẩy. Tin có dấu thì so đúng dấu, nguyên từ («gặp» không khớp «gấp»); tin không dấu thì cụm nhiều chữ khớp thẳng, từ một chữ phải để AI xác nhận.",
    envName: null, defaultValue: DEFAULT_URGENT_KEYWORDS, maxLength: 2000,
    applyTo: (config, value) => { config.alerts.urgentKeywords = asString(value); },
  },
  {
    key: "alert_important_keywords", group: "operations", label: "Từ khóa QUAN TRỌNG", type: "string", secret: false, allowEmpty: true,
    help: "Cách nhau dấu phẩy. Tin quan trọng không báo ngay — vào danh sách «cần xử lý» và bản tin.",
    envName: null, defaultValue: DEFAULT_IMPORTANT_KEYWORDS, maxLength: 2000,
    applyTo: (config, value) => { config.alerts.importantKeywords = asString(value); },
  },
  {
    key: "alert_strict_keywords", group: "operations", label: "Từ khóa cần AI xác nhận", type: "string", secret: false, allowEmpty: true,
    help: "Từ dễ báo nhầm vì hay gặp trong câu thường (vd «la», «liền», «ngay»): so đúng dấu, nguyên từ, rồi AI đọc lại tin mới quyết có khẩn không.",
    envName: null, defaultValue: DEFAULT_STRICT_KEYWORDS, maxLength: 500,
    applyTo: (config, value) => { config.alerts.strictKeywords = asString(value); },
  },
  {
    key: "alert_reply_wait_minutes", group: "operations", label: "Nhắc tin chờ sau (phút làm việc)", type: "int", secret: false,
    help: "Tin nhắc tên / hỏi thẳng người nhận, câu hỏi của khách chưa ai trả lời: quá bấy nhiêu phút GIỜ LÀM VIỆC thì nhắc (IDA: 120).",
    envName: null, defaultValue: 120, min: 10, max: 2880,
    applyTo: (config, value) => { config.alerts.replyWaitMinutes = asNumber(value); },
  },
  {
    key: "alert_vip_wait_minutes", group: "operations", label: "Nhắc tin VIP chờ sau (phút làm việc)", type: "int", secret: false,
    help: "Tin của người VIP chưa ai trả lời quá bấy nhiêu phút giờ làm việc thì nhắc (IDA: 30).",
    envName: null, defaultValue: 30, min: 5, max: 1440,
    applyTo: (config, value) => { config.alerts.vipWaitMinutes = asNumber(value); },
  },
  {
    key: "alert_daily_reminder_cap", group: "operations", label: "Số lần nhắc tối đa mỗi ngày", type: "int", secret: false,
    help: "Mỗi người nhận được nhắc tin chờ tối đa bấy nhiêu lần một ngày (IDA: 3). Tin KHẨN / VIP luôn báo, không tính vào đây.",
    envName: null, defaultValue: 3, min: 0, max: 50,
    applyTo: (config, value) => { config.alerts.dailyReminderCap = asNumber(value); },
  },
  {
    key: "alert_urgent_merge_seconds", group: "operations", label: "Gộp tin khẩn dồn trong (giây)", type: "int", secret: false,
    help: "Tin khẩn đầu tiên báo ngay; tin khẩn tới tiếp trong khoảng này được gộp thành một thông báo (IDA: 120).",
    envName: null, defaultValue: 120, min: 0, max: 1800,
    applyTo: (config, value) => { config.alerts.urgentMergeSeconds = asNumber(value); },
  },
  {
    key: "alert_ai_enabled", group: "operations", label: "AI đọc lại để bắt tin khẩn không có từ khóa", type: "bool", secret: false,
    help: "Mỗi 5 phút AI đọc gom các tin mới (đã che số điện thoại / tài khoản) để bắt tin khẩn không chứa từ khóa và xác nhận từ khóa «cần AI xác nhận». Nhóm Mật không đưa cho AI.",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.alerts.aiEnabled = value === true; },
  },
  {
    key: "alert_telegram_bot_token", group: "operations", label: "Bot Telegram báo khi Zalo văng", type: "string", secret: true, allowEmpty: true,
    help: "Mã bot Telegram (từ BotFather). Phiên Zalo của bot văng thì báo vào chat Telegram bên dưới — để bot im lặng không bị hiểu nhầm là không có tin khẩn.",
    envName: "ALERT_TELEGRAM_BOT_TOKEN", defaultValue: "", maxLength: 200,
    applyTo: (config, value) => { config.alerts.telegramBotToken = asString(value).trim(); },
  },
  {
    key: "alert_telegram_chat_id", group: "operations", label: "Chat Telegram nhận báo", type: "string", secret: false, allowEmpty: true,
    help: "Mã chat (người hoặc nhóm) nhận báo khi phiên Zalo văng.",
    envName: "ALERT_TELEGRAM_CHAT_ID", defaultValue: "", maxLength: 40, pattern: /^-?\d{1,20}$/, patternHint: "mã chat là số (nhóm thì bắt đầu bằng -)",
    applyTo: (config, value) => { config.alerts.telegramChatId = asString(value).trim(); },
  },
  {
    key: "backup_keep_days", group: "operations", label: "Giữ bản sao lưu (ngày)", type: "int", secret: false,
    help: "Bản sao lưu CSDL hằng ngày giữ trên kho tệp bấy nhiêu ngày rồi xóa.",
    envName: "BACKUP_KEEP_DAYS", defaultValue: 30, min: 3, max: 365,
    applyTo: (config, value) => { config.backup.keepDays = asNumber(value); },
  },
  {
    key: "brief_ai_highlights_enabled", group: "operations", label: "Điểm tin AI trong bản tin", type: "bool", secret: false,
    help: "Mục 5 của bản tin sáng / cuối ngày: AI chọn tối đa 3 ý nổi bật. Tắt thì bản tin vẫn gửi, chỉ bỏ mục này.",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.briefs.aiHighlightsEnabled = value === true; },
  },
  {
    key: "periodic_reports_enabled", group: "operations", label: "Tự gửi báo cáo tuần / tháng", type: "bool", secret: false,
    help: "Báo cáo tuần (08:00 thứ 2) / tháng (ngày 3) tự soạn và gửi cho mọi người nhận đang bật.",
    envName: null, defaultValue: true,
    applyTo: (config, value) => { config.briefs.periodicReportsEnabled = value === true; },
  },
];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((definition) => [definition.key, definition]));

export function findSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}
