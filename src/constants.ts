// Bộ mã số lưu trong các cột SMALLINT. Thêm giá trị mới thì thêm vào CUỐI, đừng đánh số lại.

export enum BotAccountStatus {
  Disconnected = 0,
  Connected = 1,
  // Phiên hết hạn / bị Zalo thu hồi — cần quét QR lại
  NeedsLogin = 2,
}

/** Loại tài khoản bot (cột bot_account.kind). Giao diện chép sang web/src/modules/accounts/types/account.ts. */
export enum BotAccountKind {
  /** Trợ lý: trả lời, báo, gửi tin như thường. Dòng cũ trước 27/10/2026 và mặc định của cột DB. */
  Assistant = 0,
  /** Chỉ thu thập dữ liệu: lưu tin / thành viên / tệp, KHÔNG gửi hay tác động gì lên Zalo (trừ tab «Bạn bè» do quản trị bấm). */
  Normal = 1,
}

/**
 * Loại của tài khoản MỚI sinh ra từ lượt quét QR (web hoặc CLI) — chốt 27/10/2026: mặc định Chỉ thu thập, quản trị đổi sang
 * Trợ lý ở trang chi tiết. Tài khoản đã có quét lại QR giữ nguyên loại (xem `saveLoggedInAccount`).
 */
export const NEW_ACCOUNT_KIND = BotAccountKind.Normal;

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

/** Vai trò > 0 thì bot trả lời người đó. Phạm vi dữ liệu KHÔNG theo vai trò Danh bạ mà theo tài khoản web gắn với người hỏi (xem asker-access.ts). */
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
  // Gửi tin cho MỘT nơi nhận của lệnh gửi (bảng send_command_target, phase 9) — serialKey `send:<lệnh>` giữ thứ tự
  SendCommandTarget = 6,
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

/** Nguồn của một lệnh gửi (bảng send_command, phase 9). Giao diện chép sang web/src/modules/send-commands/types. */
export enum SendCommandSource {
  // Quản lý nhắn bot trong cuộc riêng
  Zalo = 1,
  // Quản trị gửi từ màn web (chỉ ghi nhật ký)
  Web = 2,
}

/** Việc một lệnh làm ở mỗi nơi nhận (cột send_command.action_kind). Giao diện chép sang web/src/modules/send-commands/types. */
export enum SendActionKind {
  // Gửi tin (mặc định, phase 9)
  Message = 1,
  // Tạo nhắc hẹn Zalo cho nhóm (chỉ nhóm) — từ tin riêng, có xem trước
  Reminder = 2,
  // Ghim ghi chú lên nhóm (chỉ nhóm) — từ tin riêng, có xem trước; body = nội dung ghim
  Pin = 3,
}

/** Vòng đời một lệnh gửi: Draft →(đồng ý)→ Scheduled | Sending → Done; Draft quá hạn → Expired; Draft / Scheduled → Cancelled. */
export enum SendCommandStatus {
  // Đã dựng bản xem trước, chờ «đồng ý» (15 phút)
  Draft = 1,
  // Đã đồng ý, chờ tới giờ hẹn
  Scheduled = 2,
  Sending = 3,
  Done = 4,
  Cancelled = 5,
  // Nháp quá hạn xác nhận
  Expired = 6,
}

/** Loại nơi nhận của lệnh gửi (bảng send_command_target). */
export enum SendTargetKind {
  Group = 1,
  Person = 2,
}

/** Trạng thái từng nơi nhận: Pending → Queued → Sent | Failed; Failed →(gửi lại)→ Queued. */
export enum SendTargetStatus {
  Pending = 1,
  Queued = 2,
  Sent = 3,
  Failed = 4,
  Cancelled = 5,
}

/** Vòng đời mẫu tin trả lời (cột reply_template.status): Draft →(gửi duyệt)→ PendingReview → Approved | Returned; sửa mẫu Approved → PendingReview. Bot chỉ dùng Approved. Giao diện chép sang web/src/modules/reply-templates/types. */
export enum ReplyTemplateStatus {
  Draft = 1,
  PendingReview = 2,
  Approved = 3,
  // Bị trả lại kèm ghi chú (review_note)
  Returned = 4,
  // Ngừng dùng
  Archived = 5,
}

/** Tông của mẫu / bản nháp trả lời (cột reply_template.tone). */
export enum ReplyTone {
  Formal = 1,
  Friendly = 2,
  Brief = 3,
}

/** Tình trạng lượt đọc gần nhất của một nguồn số liệu (cột metric_source.status). Giao diện chép sang web/src/modules/metrics/types. */
export enum MetricSourceStatus {
  NeverRun = 0,
  Ok = 1,
  // Không đọc được bảng (quyền, mạng, tab không tồn tại)
  Failed = 2,
  // Đọc được nhưng ánh xạ cột không khớp tiêu đề
  MappingError = 3,
}

/** Cờ của một dòng số liệu (cột metric_value.flags) — BIT, cộng được: Negative | Deviation = 3. */
export enum MetricFlag {
  Negative = 1,
  // Lệch quá ±30% so với kỳ trước
  Deviation = 2,
  // Ô không đọc được thành số
  Unparsed = 4,
  // Tên nhân viên không có trong danh mục
  UnknownStaff = 8,
}

/** Loại dòng danh mục (cột catalog_entry.kind). Giao diện chép sang web/src/modules/catalog/types. */
export enum CatalogKind {
  Staff = 1,
  Dealer = 2,
}

/** Tình trạng khớp dòng danh mục với liên hệ Zalo (cột catalog_entry.match_status). */
export enum CatalogMatchStatus {
  Unmatched = 0,
  // Khớp chắc theo SĐT
  Matched = 1,
  // Khớp theo tên, không chắc — chờ quản trị xác nhận
  Suggested = 2,
  Confirmed = 3,
  // Quản trị đã «Bỏ gắn»: lượt khớp tự động sau KHÔNG gắn lại; chỉ gắn khi quản trị chọn tay, hoặc nạp tệp đổi SĐT của mục (về Unmatched)
  Unlinked = 4,
}

/** Mức quyền của khóa MCP (cột mcp_api_key.access_level) — khóa chỉ HẠ được quyền của chủ khóa, không nâng. Giao diện chép sang web/src/modules/mcp-keys/types. */
export enum McpAccessLevel {
  Read = 1,
  ReadWrite = 2,
}

/** Loại khóa MCP (cột mcp_api_key.kind, migration 045). Giao diện chép sang web/src/modules/mcp-keys/types. */
export enum McpKeyKind {
  // Khóa dán tay tạo ở màn «Khóa MCP»
  Manual = 0,
  // Kết nối OAuth (claude.ai / ChatGPT / Claude Desktop bấm «Cho phép»)
  OAuth = 1,
}

/** Kết quả một lời gọi công cụ (cột mcp_call_log.status). */
export enum McpCallStatus {
  Ok = 0,
  // Không đủ quyền / ngoài phạm vi
  Denied = 1,
  // Tham số sai (sai trường, sai phép so, quá trần)
  Invalid = 2,
  // Lỗi hệ thống
  Error = 3,
  // Vượt giới hạn nhịp theo khóa
  RateLimited = 4,
}

/** Cổng gọi công cụ (cột mcp_call_log.source). */
export enum McpCallSource {
  // Máy chủ MCP /mcp (Claude, Codex, client SDK)
  Http = 1,
  // Trợ lý trong app (Gemini / OpenAI): công cụ do MÔ HÌNH gọi
  Assistant = 2,
  // Trợ lý trong app: lệnh người dùng gõ (chạy ngay, mô hình không thấy mặt này)
  AssistantCommand = 3,
}
