// Bộ mã số lưu trong các cột SMALLINT. Thêm giá trị mới thì thêm vào CUỐI, đừng đánh số lại.

export enum BotAccountStatus {
  Disconnected = 0,
  Connected = 1,
  // Phiên hết hạn / bị Zalo thu hồi — cần quét QR lại
  NeedsLogin = 2,
}

export enum MessageKind {
  Text = 0,
  Image = 1,
  File = 2,
  Video = 3,
  Voice = 4,
  Sticker = 5,
  Link = 6,
  Location = 7,
  Contact = 8,
  // Dòng sự kiện nhóm (vào / rời / thêm người / đổi tên) — không có người gửi thật, vẽ giữa khung chat
  System = 9,
  Other = 99,
}

export enum AttachmentStatus {
  Pending = 0,
  Stored = 1,
  Failed = 2,
  // Nhóm không bật lấy file — chỉ ghi tên file + thời điểm
  Skipped = 3,
  // Quá hạn giữ tệp gốc của nhóm (file_retention_days): tệp đã xóa, chữ đã bóc vẫn còn (08/10/2026)
  Expired = 4,
}

export enum SessionEvent {
  LoginCookieOk = 0,
  LoginCookieFailed = 1,
  LoginQrOk = 2,
  Connected = 3,
  Disconnected = 4,
  Closed = 5,
  Error = 6,
  Stopped = 7,
}

/** Mã đóng kết nối của listener zca-js — có ý nghĩa vận hành riêng. */
export const CLOSE_CODE_DUPLICATE = 3000; // có nơi khác mở Zalo Web cùng tài khoản
export const CLOSE_CODE_KICKED = 3003; // Zalo đá phiên

export enum ConversationType {
  Direct = 0, // trò chuyện riêng 1-1 giữa một người và một bot
  Group = 1,
}

export enum ContactKind {
  Unclassified = 0,
  Customer = 1,
  Staff = 2,
}

/** Vai trò > 0 thì bot trả lời người đó. Quyền hiện MỞ HẾT: mọi vai trò hỏi được mọi nhóm. */
export enum ContactRole {
  None = 0,
  DepartmentHead = 1,
  Manager = 2,
}

export enum AssistantTurnStatus {
  Answered = 0,
  Failed = 1,
  RateLimited = 2,
  DailyCapReached = 3,
}

/** Loại nhóm quyết định loại mặc định của thành viên trong Danh bạ. */
export enum GroupKind {
  Customer = 1,
  Internal = 2,
}

export enum ContactKindSource {
  Auto = 0, // suy theo nhóm
  Manual = 1, // quản trị chỉnh tay — tự động không ghi đè
}

/** Loại việc trong hàng đợi (bảng job, 08/10/2026). */
export enum JobKind {
  // Trả lời một câu hỏi nhắn riêng cho bot
  AssistantDirectReply = 1,
  // Trả lời khi bot được gọi trong nhóm
  AssistantGroupReply = 2,
}

/** Mức ưu tiên của một tin (bảng message_flag). */
export enum MessagePriority {
  Normal = 0,
  Important = 1,
  Urgent = 2,
}

/** Tin này có cần ai trả lời không, và tới đâu rồi (bảng message_flag). */
export enum ReplyState {
  NotNeeded = 0,
  Waiting = 1,
  // Có người thả cảm xúc — đã xem nhưng chưa trả lời, vẫn nhắc (IDA câu 8)
  Seen = 2,
  Handled = 3,
}

/** Cái gì gắn cờ cho tin. */
export enum FlagSource {
  Keyword = 1,
  Vip = 2,
  Ai = 3,
  // Người nhận đánh dấu tay (vd «xong rồi»)
  Manual = 4,
  // Tin nhắc tên / hỏi thẳng người nhận
  Mention = 5,
}

/** Kết quả lượt chạy gần nhất của một việc theo lịch (bảng schedule_run). */
export enum ScheduleRunStatus {
  NeverRun = 0,
  Running = 1,
  Done = 2,
  Failed = 3,
}

/** Trạng thái một việc trong hàng đợi. */
export enum JobStatus {
  Pending = 0,
  Running = 1,
  Done = 2,
  // Hết số lần thử mà vẫn lỗi
  Failed = 3,
  // Chờ quá `expires_at` mà chưa chạy — bỏ, không làm nữa
  Expired = 4,
}

/**
 * Hãng của một dòng «Khóa AI» (bảng ai_key, 07/10/2026). Giao diện chép sang `web/src/modules/settings/types/ai-key.ts`.
 * Mọi hãng trừ Gemini nói API kiểu OpenAI (Chat Completions) — chạy qua OpenAIClient với địa chỉ trạm của hãng.
 */
export enum AiKeyProvider {
  Gemini = 1,
  OpenAI = 2,
  // Trạm trung gian / máy chủ tự dựng nói API kiểu OpenAI (vd modelapi.vn) — địa chỉ trạm nhập theo từng khóa
  OpenAICompatible = 3,
  DeepSeek = 4,
  Xai = 5,
  OpenRouter = 6,
}
