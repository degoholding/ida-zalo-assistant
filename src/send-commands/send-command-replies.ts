// Câu cố định của lệnh gửi (tệp LÁ — không import cầu nối MCP, để lõi `data-access/send/` và lớp lệnh cùng dùng mà không vòng import).

/** Bot không nhận ra người này là người ra lệnh được. */
export const NOT_ALLOWED_REPLY = "Lệnh gửi tin chỉ dành cho người nhận cảnh báo hoặc Quản lý / Trưởng phòng ạ.";
/** Chỉ ra lệnh trong tin riêng với bot — nhóm không ra lệnh gửi. */
export const GROUP_NOT_ALLOWED_REPLY = "Anh/chị nhắn riêng cho em để ra lệnh gửi tin nhé — trong nhóm em không nhận lệnh gửi.";
