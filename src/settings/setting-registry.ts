import type { AppConfig } from "../config.js";
import { parseServiceAccount, parseSpreadsheetId } from "../google/service-account.js";

// Danh mục cài đặt sửa được trên màn Cài đặt — khai MỘT chỗ ở đây. Thêm khóa = thêm một dòng vào mảng;
// API, kho lưu và giao diện tự có ô. Thứ tự ưu tiên: giá trị trên web (app_setting) > .env > mặc định.
// Những thứ cần có trước khi vào được DB / web (DATABASE_URL, khóa mã hóa, mật khẩu, cổng…) KHÔNG đưa lên đây.

export type SettingGroup = "assistant" | "sync" | "google";
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
  /** Kiểm thêm + chuẩn hóa sau khi ép kiểu (vd JSON service account). */
  normalize?: (value: SettingValue) => SettingValue;
  /** Phủ giá trị đang hiệu lực lên AppConfig (vd MB → byte). */
  applyTo: (config: AppConfig, value: SettingValue) => void;
}

const MB = 1024 * 1024;
const MODEL_PATTERN = /^[a-z0-9.-]{3,80}$/;
const MODEL_HINT = "tên mô hình chỉ gồm chữ thường, số, dấu chấm, gạch ngang (3–80 ký tự)";

const asString = (value: SettingValue) => (typeof value === "string" ? value : "");
const asNumber = (value: SettingValue) => Number(value);
const asList = (value: SettingValue) => (Array.isArray(value) ? value : []);

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "gemini_api_key", group: "assistant", label: "Khóa Gemini", type: "string", secret: true,
    help: "Khóa API Google Gemini. Để trống = trợ lý tắt: bot vẫn lưu tin, không trả lời ai.",
    envName: "GEMINI_API_KEY", defaultValue: "", maxLength: 200, pattern: /^\S+$/, patternHint: "khóa không được có khoảng trắng",
    applyTo: (config, value) => { config.assistant.apiKey = asString(value).trim(); },
  },
  {
    key: "gemini_model", group: "assistant", label: "Mô hình chính", type: "string", secret: false,
    help: "Mô hình trả lời câu hỏi thường ngày.",
    envName: "GEMINI_MODEL", defaultValue: "gemini-3.5-flash-lite", pattern: MODEL_PATTERN, patternHint: MODEL_HINT,
    applyTo: (config, value) => { config.assistant.model = asString(value); },
  },
  {
    key: "gemini_model_heavy", group: "assistant", label: "Mô hình việc nặng", type: "string", secret: false,
    help: "Tóm tắt dài, đọc tệp / ảnh đi mô hình này. Để trống = dùng mô hình chính.",
    envName: "GEMINI_MODEL_HEAVY", defaultValue: "gemini-3.5-flash", pattern: MODEL_PATTERN, patternHint: MODEL_HINT, allowEmpty: true,
    applyTo: (config, value) => { config.assistant.heavyModel = asString(value); },
  },
  {
    key: "gemini_fallback_models", group: "assistant", label: "Mô hình dự phòng", type: "list", secret: false,
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
    help: "Tệp lớn hơn thì bot từ chối đọc (xlsx, docx, pdf, txt, csv, ảnh).",
    envName: "ASSISTANT_MAX_READ_FILE_MB", defaultValue: 5, min: 1, max: 20,
    applyTo: (config, value) => { config.assistant.maxReadFileBytes = asNumber(value) * MB; },
  },
  {
    key: "assistant_send_interval_ms", group: "assistant", label: "Giãn cách gửi tin (mili giây)", type: "int", secret: false,
    help: "Khoảng nghỉ giữa hai tin bot gửi. Dưới 500 dễ bị Zalo khóa tài khoản.",
    envName: "ASSISTANT_SEND_INTERVAL_MS", defaultValue: 1500, min: 500, max: 10_000,
    applyTo: (config, value) => { config.assistant.sendIntervalMs = asNumber(value); },
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
    key: "google_spreadsheet_url", group: "google", label: "Link trang tính", type: "string", secret: false,
    help: "Link Google Sheet bot ghi vào (đã chia sẻ quyền Người chỉnh sửa cho email service account).",
    envName: null, defaultValue: "", maxLength: 500, allowEmpty: true,
    normalize: (value) => { if (value) parseSpreadsheetId(String(value)); return value; },
    applyTo: (config, value) => { config.google.spreadsheetUrl = asString(value); },
  },
];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((definition) => [definition.key, definition]));

export function findSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}
