import type { LucideIcon } from 'lucide-react'
import {
  BellRing,
  Bot,
  CalendarClock,
  Clock,
  DatabaseBackup,
  Gem,
  FileSpreadsheet,
  FileText,
  Gauge,
  Globe,
  HardDriveDownload,
  History,
  KeyRound,
  LogIn,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react'

/** Một thẻ trong tab Cài đặt: gom các khóa cùng chủ đề — không xếp phẳng 17 ô một mạch. */
export interface SettingsSection {
  id: string
  title: string
  description: string
  icon: LucideIcon
  /** Khóa cài đặt theo thứ tự hiện. Khóa máy chủ có mà không khai ở đây rơi vào thẻ «Khác». */
  keys: string[]
}

export const ASSISTANT_SECTIONS: SettingsSection[] = [
  {
    id: 'ai-provider',
    title: 'Nhà cung cấp & khóa AI',
    description: 'Chọn Gemini hoặc OpenAI (Codex / GPT) — hoặc ưu tiên OpenAI, lỗi thì tự chuyển sang Gemini.',
    icon: KeyRound,
    keys: ['ai_provider', 'openai_api_key', 'openai_base_url', 'gemini_api_key'],
  },
  {
    id: 'openai-models',
    title: 'Mô hình OpenAI',
    description: 'Dùng khi nhà cung cấp là OpenAI. Rẻ: gpt-6-luna · tầm trung: gpt-6.1-sol · mạnh nhất: gpt-6-astra.',
    icon: Sparkles,
    keys: ['openai_model', 'openai_model_heavy', 'openai_fallback_models'],
  },
  {
    id: 'gemini-models',
    title: 'Mô hình Gemini',
    description: 'Dùng khi nhà cung cấp là Gemini, hoặc khi OpenAI lỗi ở chế độ ưu tiên OpenAI.',
    icon: Gem,
    keys: ['gemini_model', 'gemini_model_heavy', 'gemini_fallback_models'],
  },
  {
    id: 'web-search',
    title: 'Tìm web',
    description:
      'Khóa Tavily để trợ lý tìm thông tin công khai (giá vàng, tỷ giá, tin tức, báo cáo công ty) mà không phụ thuộc Gemini. Trống = chỉ tìm qua Gemini nếu khóa Gemini còn tiền.',
    icon: Globe,
    keys: ['assistant_tavily_api_key'],
  },
  {
    id: 'group',
    title: 'Trong nhóm Zalo',
    description: 'Bot trả lời trong nhóm khi được gọi — chỉ nhân sự / người có vai trò, khách hàng gọi thì bot im lặng.',
    icon: Users,
    keys: ['group_reply_enabled', 'group_reply_anyone', 'group_trigger_keywords'],
  },
  {
    id: 'files',
    title: 'Đọc tệp',
    description: 'Loại tệp và cỡ tệp bot được đọc / nghe (ghi âm cuộc họp → recap PDF).',
    icon: FileText,
    keys: ['assistant_readable_file_types', 'assistant_max_read_file_mb'],
  },
  {
    id: 'limits',
    title: 'Giới hạn & hiển thị',
    description: 'Chặn hỏi quá nhiều, trần chi phí mỗi ngày, số câu trả lời chạy cùng lúc, tốc độ gửi tin chống khóa tài khoản.',
    icon: Gauge,
    keys: [
      'assistant_max_per_hour',
      'assistant_daily_token_cap',
      'assistant_daily_token_cap_per_bot',
      'assistant_concurrency',
      'assistant_send_interval_ms',
      'assistant_show_token_usage',
    ],
  },
  {
    id: 'privacy',
    title: 'An toàn dữ liệu',
    description: 'Che số điện thoại / tài khoản / CCCD trước khi gửi AI, chặn tìm web với câu hỏi kỹ thuật thuốc BVTV, chọn hãng AI được nhận dữ liệu.',
    icon: ShieldCheck,
    keys: ['privacy_mask_personal_data', 'privacy_block_web_agro_technical', 'privacy_allowed_ai_providers'],
  },
]

export const SYNC_SECTIONS: SettingsSection[] = [
  {
    id: 'new-groups',
    title: 'Nhóm mới',
    description: 'Mặc định cho nhóm bot vừa vào — sửa từng nhóm ở màn Nhóm.',
    icon: UsersRound,
    keys: ['default_group_read', 'default_group_capture_files'],
  },
  {
    id: 'new-dms',
    title: 'Cuộc riêng mới',
    description: 'Mặc định cho người lạ nhắn riêng cho bot.',
    icon: MessageCircle,
    keys: ['default_dm_read', 'default_dm_capture_files'],
  },
  {
    id: 'downloads',
    title: 'Tải tệp về kho',
    description: 'Giới hạn cỡ tệp bot tải về lưu trữ.',
    icon: HardDriveDownload,
    keys: ['max_file_mb'],
  },
]

export const GOOGLE_SECTIONS: SettingsSection[] = [
  {
    id: 'login',
    title: 'Đăng nhập Google',
    description: 'Client ID của OAuth client (loại Web) để hiện nút «Đăng nhập bằng Google» ở màn đăng nhập. Để trống = chỉ đăng nhập bằng tài khoản + mật khẩu.',
    icon: LogIn,
    keys: ['google_login_client_id'],
  },
  {
    id: 'sheets',
    title: 'Google Sheets — xuất báo cáo',
    description: 'Khóa service account + trang tính để trợ lý ghi báo cáo.',
    icon: FileSpreadsheet,
    keys: ['google_service_account_json', 'google_spreadsheet_url'],
  },
  {
    id: 'calendar',
    title: 'Google Calendar & Meet — tạo cuộc họp',
    description: 'Chép Client ID + Client secret của OAuth client rồi bấm «Kết nối Google».',
    icon: CalendarClock,
    keys: ['google_oauth_client_id', 'google_oauth_client_secret'],
  },
]

export const OPERATIONS_SECTIONS: SettingsSection[] = [
  {
    id: 'work-calendar',
    title: 'Giờ làm việc',
    description: 'Đồng hồ chờ trả lời chỉ chạy trong giờ làm; giờ yên lặng và ngày nghỉ chỉ báo tin KHẨN / VIP.',
    icon: Clock,
    keys: ['work_hours', 'work_days', 'quiet_hours', 'holidays'],
  },
  {
    id: 'alerts',
    title: 'Cảnh báo tin nhắn',
    description:
      'Bot tự đọc tin trong nhóm, báo KHẨN / VIP cho người nhận qua Zalo. Từ khóa có dấu khớp đúng dấu, đúng nguyên chữ; từ «nghiêm» (la, liền, ngay) chỉ tính khi AI xác nhận.',
    icon: BellRing,
    keys: ['alert_enabled', 'alert_urgent_keywords', 'alert_important_keywords', 'alert_strict_keywords', 'alert_ai_enabled'],
  },
  {
    id: 'alert-timing',
    title: 'Đồng hồ chờ & nhắc',
    description:
      'Tin hỏi người nhận / khách hỏi mà chưa ai trả lời quá số phút làm việc thì nhắc. Tin thường nhắc tối đa vài lần / ngày; tin KHẨN gộp lại trong vài phút rồi báo một lần.',
    icon: Timer,
    keys: ['alert_reply_wait_minutes', 'alert_vip_wait_minutes', 'alert_daily_reminder_cap', 'alert_urgent_merge_seconds'],
  },
  {
    id: 'alert-telegram',
    title: 'Kênh dự phòng Telegram',
    description: 'Phiên Zalo của bot văng thì báo qua Telegram (Zalo không gửi được). Để trống = không báo.',
    icon: Send,
    keys: ['alert_telegram_bot_token', 'alert_telegram_chat_id'],
  },
  {
    id: 'backup',
    title: 'Sao lưu',
    description: 'Bản sao lưu CSDL hằng ngày đẩy lên kho tệp.',
    icon: DatabaseBackup,
    keys: ['backup_keep_days'],
  },
]

export const SETTINGS_TABS = [
  // Đứng đầu cho dễ thấy (đại ca 07/10/2026: ~19 ô AI rời khó dùng) — mở màn Cài đặt là vào thẳng tab này
  { id: 'ai-keys', label: 'Khóa AI', icon: KeyRound },
  { id: 'assistant', label: 'Trợ lý AI', icon: Bot },
  { id: 'sync', label: 'Đồng bộ Zalo', icon: RefreshCw },
  { id: 'operations', label: 'Vận hành', icon: Wrench },
  { id: 'google', label: 'Google', icon: FileSpreadsheet },
  { id: 'history', label: 'Lịch sử thay đổi', icon: History },
] as const

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']
