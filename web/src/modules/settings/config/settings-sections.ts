import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  CalendarClock,
  Gem,
  FileSpreadsheet,
  FileText,
  Gauge,
  HardDriveDownload,
  History,
  KeyRound,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Users,
  UsersRound,
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
    description: 'Chặn hỏi quá nhiều, trần chi phí mỗi ngày, tốc độ gửi tin chống khóa tài khoản.',
    icon: Gauge,
    keys: ['assistant_max_per_hour', 'assistant_daily_token_cap', 'assistant_send_interval_ms', 'assistant_show_token_usage'],
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

export const SETTINGS_TABS = [
  { id: 'assistant', label: 'Trợ lý AI', icon: Bot },
  { id: 'sync', label: 'Đồng bộ Zalo', icon: RefreshCw },
  { id: 'google', label: 'Google', icon: FileSpreadsheet },
  { id: 'history', label: 'Lịch sử thay đổi', icon: History },
] as const

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id']
