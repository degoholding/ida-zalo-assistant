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

/** Vai trò người dùng giao diện quản trị (bảng app_user, phase 4). Giao diện chép sang web/src/core/auth. */
export enum UserRole {
  // Toàn quyền: cài đặt, tài khoản bot, người dùng, người nhận, mọi nhóm
  Admin = 1,
  // Xem nhóm trong phạm vi, sửa Danh bạ / nhóm trong phạm vi, gửi tin dưới tên bot
  Manager = 2,
  // Chỉ xem nhóm / tệp trong phạm vi
  Staff = 3,
}

/** Loại việc trong hàng đợi (bảng job, 08/10/2026). */
export enum JobKind {
  // Trả lời một câu hỏi nhắn riêng cho bot
  AssistantDirectReply = 1,
  // Trả lời khi bot được gọi trong nhóm
  AssistantGroupReply = 2,
  // Bot nhắn riêng cho một người nhận (kênh báo / lệnh, phase 4) — tiến trình app gửi vì giữ phiên Zalo
  RecipientMessage = 3,
  // Gom tin KHẨN / VIP chưa báo của một người nhận thành một thông báo rồi gửi (phase 5)
  AlertDispatch = 4,
  // Bot nhắn một người (tin riêng) hoặc vào một cuộc có sẵn, kèm tệp đã cất — báo ticket (08/10/2026)
  ContactMessage = 5,
}

/** Trạng thái ticket (bảng ticket). Giao diện chép sang web/src/modules/tickets/types. */
export enum TicketStatus {
  New = 1,
  InProgress = 2,
  Done = 3,
  Cancelled = 4,
}

/** Loại dòng nhật ký ticket (bảng ticket_event). */
export enum TicketEventKind {
  Created = 1,
  Accepted = 2,
  Note = 3,
  Done = 4,
  Cancelled = 5,
  Reopened = 6,
}

/** Trạng thái việc (bảng task, phase 7). Giao diện chép sang web/src/modules/tasks/types. */
export enum TaskStatus {
  // Đề xuất (AI bắt từ tin) chờ người giao / sếp xác nhận
  Proposed = 1,
  Open = 2,
  Done = 3,
  Cancelled = 4,
}

/** Mức ưu tiên của việc — như cột «Ưu tiên» của recap họp. */
export enum TaskPriority {
  High = 1,
  Normal = 2,
  Low = 3,
}

/** Việc vào checklist từ đâu. */
export enum TaskSource {
  // Lệnh gõ «giao …»
  Command = 1,
  // Câu tự nhiên với trợ lý (công cụ create_task)
  Assistant = 2,
  // Phân công trong recap họp
  Recap = 3,
  // AI tự bắt câu giao việc trong nhóm (lượt đọc tin 5 phút)
  AiReview = 4,
  Web = 5,
}

/** Mốc nhắc hạn đã gửi (task.remind_stage). */
export enum TaskRemindStage {
  None = 0,
  // Ngày làm việc liền trước ngày hạn, đầu giờ làm
  DayBefore = 1,
  Due = 2,
  Overdue = 3,
}

/** Loại dòng nhật ký việc (bảng task_event). */
export enum TaskEventKind {
  Created = 1,
  Confirmed = 2,
  Rejected = 3,
  Done = 4,
  Reopened = 5,
  Rescheduled = 6,
  Reassigned = 7,
  Cancelled = 8,
  Note = 9,
  Reminded = 10,
  // Đề xuất không ai xác nhận, tự bỏ
  Expired = 11,
}

/** Loại báo trong bảng alert_log (phase 5). */
export enum AlertKind {
  // Tin KHẨN / VIP — báo ngay, kể cả giờ yên lặng, không tính vào trần mỗi ngày
  Urgent = 1,
  // Nhắc tin chờ quá giờ chưa ai trả lời — tối đa N lần báo / ngày, không báo trong giờ yên lặng
  Reminder = 2,
  // Việc trong checklist quá hạn (phase 7) — chung trần N lần báo / ngày với Reminder; cột message_id giữ id VIỆC
  TaskOverdue = 3,
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

/** Chiều của một lời mời kết bạn với tài khoản bot (bảng friend_request, 08/10/2026). Giao diện chép sang `web/src/modules/accounts/types/friend-request.ts`. */
export enum FriendRequestDirection {
  // Người khác mời bot kết bạn
  Incoming = 1,
  // Bot mời người khác (quản trị bấm «Gửi lời mời» ở tab Kết bạn)
  Outgoing = 2,
}

/** Lời mời kết bạn tới đâu rồi (bảng friend_request). */
export enum FriendRequestStatus {
  Pending = 0,
  Accepted = 1,
  // Lời mời bị từ chối (hoặc Zalo không còn giữ lời mời mà hai bên chưa là bạn)
  Rejected = 2,
  // Bên gửi rút lại lời mời
  Cancelled = 3,
}

/** Loại bản tin / báo cáo (bảng brief_log, phase 8). Giao diện chép sang web/src/modules/briefs/types (phase 5). */
export enum BriefKind {
  Morning = 1,
  Evening = 2,
  Weekly = 3,
  Monthly = 4,
}

/** Cái gì làm một bản tin / báo cáo được soạn. */
export enum BriefTrigger {
  // Việc nền theo giờ hẹn của người nhận / lịch tuần-tháng
  Schedule = 1,
  // Câu tự nhiên nhắn bot («bản tin sáng», «báo cáo tuần»)
  Chat = 2,
  // Nút «Gửi thử bản tin» trên web
  WebTest = 3,
}

/** Một dòng brief_log tới đâu rồi. */
export enum BriefStatus {
  // Đang soạn (vừa giành lượt bằng INSERT IGNORE) — kẹt quá 15 phút thì lượt sau soạn lại
  Composing = 1,
  // Đã soạn xong, đã xếp vào hàng đợi gửi
  Queued = 2,
  Sent = 3,
  Failed = 4,
}

/**
 * Một dòng meeting_recording (bảng chống trùng ghi âm Drive, phase 3 recap họp) tới đâu rồi. Lý do Skipped ghi ở cột
 * `note`: nhóm Mật, quá cỡ, không rõ nơi gửi, không phải ghi âm, AI không cho phép.
 */
export enum MeetingRecordingStatus {
  // Không khớp cuộc họp nào trong cửa sổ — không thử lại (gọi Calendar đã thành công, chỉ là không có ứng viên)
  Unmatched = 1,
  // Đã khớp cuộc họp + rõ nơi gửi — chờ phase 4 gỡ băng
  Queued = 2,
  // Đã giành lượt xử lý (claimed_at) — kẹt quá 45 phút thì lượt sau trả về Queued
  Processing = 3,
  Done = 4,
  // Hết số lần thử (phase 4) mà vẫn lỗi
  Failed = 5,
  Skipped = 6,
}
