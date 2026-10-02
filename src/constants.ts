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
