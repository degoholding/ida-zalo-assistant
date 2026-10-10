/** Nhóm cài đặt — khớp mỗi tab trên màn Cài đặt (doc 04 mục 3). */
export type SettingGroup = 'assistant' | 'sync' | 'google' | 'operations'

/** Kiểu dữ liệu một khóa — quyết định ô nhập nào `SettingField` vẽ ra. */
export type SettingType = 'string' | 'int' | 'bool' | 'list' | 'json'

/** Nguồn giá trị đang hiệu lực: web > .env > mặc định trong mã (doc 04 mục 2.1). */
export type SettingSource = 'web' | 'env' | 'default'

/** Giá trị cài đặt — danh sách luôn là mảng chuỗi, không có object lồng. */
export type SettingPrimitive = string | number | boolean | string[] | null

/** Một lựa chọn sẵn của ô danh sách (vẽ thành ô tick, gom theo `group`). */
export interface SettingChoice {
  value: string
  label: string
  group: string
}

/** Một khóa như `GET /api/settings` trả về (doc 04 mục 7). */
export interface SettingView {
  key: string
  group: SettingGroup
  label: string
  help: string
  type: SettingType
  secret: boolean
  /** Luôn `null` khi `secret` — máy chủ không bao giờ trả giá trị bí mật nguyên văn. */
  value: SettingPrimitive
  /** Đang có giá trị hiệu lực khác rỗng (web, .env, hoặc mặc định không rỗng). */
  is_set: boolean
  /** Gợi ý ô bí mật: "…abcd", client_email, hoặc câu báo giải mã hỏng. Rỗng khi không bí mật. */
  hint: string
  source: SettingSource
  /** Luôn `null` khi `secret` hoặc khi biến `.env` chưa đặt. */
  env_value: SettingPrimitive
  /** Luôn `null` khi `secret`. */
  default_value: SettingPrimitive
  min: number | null
  max: number | null
  max_length: number | null
  /** `string` / `list` được phép để trống. */
  allow_empty: boolean
  /** Lựa chọn sẵn của ô danh sách — có thì vẽ ô tick thay cho ô nhập chữ. */
  choices?: SettingChoice[] | null
}

/** `POST /api/settings/google/test` thành công — ghi thử một dòng vào trang tính. */
export interface GoogleTestResult {
  ok: true
  spreadsheet_title: string
  sheet_title: string
  appended_range: string
}

/**
 * `GET /api/google/oauth/status` — trạng thái kết nối Google Calendar / Meet
 * (OAuth người dùng, khác hẳn khóa service account của Google Sheets).
 */
export interface GoogleOauthStatus {
  client_configured: boolean
  connected: boolean
  email: string
  /** URL chính xác phải khai ở "Authorized redirect URIs" trên Google Cloud. */
  redirect_uri: string
  /** Đã tick quyền đọc Drive (chỉ xem) lúc đồng ý — cần cho «Recap họp tự động». Kết nối từ trước phase này = false. */
  drive_scope_granted: boolean
}

/** `POST /api/settings/google/drive-test` thành công — kiểm thư mục «Ghi âm họp» qua Gmail đã kết nối. */
export interface DriveTestResult {
  ok: true
  folder_name: string
  audio_files_7d: number
}

/** `POST /api/google/oauth/start` thành công — URL đưa trình duyệt sang màn xin quyền của Google. */
export interface GoogleOauthStartResult {
  auth_url: string
}

/**
 * Giá trị trên FORM của một tab — khóa là `SettingView.key`. Danh sách giữ
 * dưới dạng một chuỗi cách nhau bằng dấu phẩy (như ô nhập hiện ra), không phải
 * mảng — máy chủ chấp nhận cả hai, giữ chuỗi cho form đơn giản.
 */
export type SettingFormValues = Record<string, string | number | boolean>
