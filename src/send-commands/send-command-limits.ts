// Giới hạn của lệnh gửi (phase 9). Đã chốt 12/10/2026 — đổi ở đây là đổi cho cả lệnh gõ, công cụ AI và màn web.

/** Số nơi nhận tối đa mỗi lệnh (gửi hàng loạt lớn để giai đoạn 2). */
export const MAX_TARGETS = 10;
/** Nháp chờ «đồng ý» tối đa ngần này. */
export const CONFIRM_TTL_MS = 15 * 60_000;
/** Tệp / ảnh người ra lệnh gửi bot trong cuộc riêng, trong ngần này mới đính kèm được. */
export const ATTACH_WINDOW_MS = 10 * 60_000;
export const MAX_ATTACHMENTS = 5;
export const MAX_BODY_CHARS = 4000;
/** Lệnh đã xác nhận mỗi giờ mỗi người. */
export const MAX_CONFIRMED_PER_HOUR = 10;
/** Nháp mỗi giờ mỗi người. */
export const MAX_DRAFTS_PER_HOUR = 20;
/** Hẹn xa nhất. */
export const MAX_SCHEDULE_AHEAD_DAYS = 30;
/** App tắt quá ngần này sau giờ hẹn thì bỏ, không gửi trễ. */
export const SCHEDULED_JOB_GRACE_MS = 2 * 3_600_000;

/** Tiêu đề nhắc hẹn Zalo (cột `body` của lệnh nhắc hẹn) dài nhất. */
export const MAX_REMINDER_TITLE_CHARS = 200;
/** Giờ nhắc phải cách hiện tại ít nhất ngần này (cũng là mức kiểm lại lúc «đồng ý» và lúc giao). */
export const MIN_REMINDER_LEAD_MS = 60_000;
/** Nhắc hẹn xa nhất — cùng trần `create_reminder` trong nhóm. */
export const MAX_REMINDER_AHEAD_DAYS = 366;
