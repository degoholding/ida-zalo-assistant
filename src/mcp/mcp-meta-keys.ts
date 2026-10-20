// Khóa `_meta` của kết quả công cụ (chỉ phát ở mặt trợ lý, xem mcp-tool-result.ts). Tiền tố riêng để không đụng khóa của giao thức.

/** Payload lỗi có cấu trúc `{ code, message, allowed? }` — bộ chuyển của trợ lý đổi lại thành lỗi cho mô hình. */
export const ERROR_META_KEY = "bot-tro-ly/error";
/** `TurnEffects` của lượt — KHÔNG bao giờ tới mô hình, cũng không bao giờ phát ở mặt `mcp_http`. */
export const TURN_META_KEY = "bot-tro-ly/turn";
