import type { ScheduleSpec } from "./scheduler.js";

// Danh mục việc nền chạy theo lịch — khai MỘT chỗ để tiến trình worker chạy và màn Cài đặt (tiến trình app) hiện trạng
// thái mà không phải hỏi worker. Thêm việc = thêm một dòng ở đây + một hàm chạy ở src/background.ts.

export const BACKGROUND_TASKS = [
  { name: "avatars", label: "Tải ảnh đại diện", spec: { every: "minutes", minutes: 2 } },
  { name: "retention", label: "Dọn tin và tệp gốc quá hạn giữ", spec: { every: "day", at: "02:00" } },
  { name: "job-housekeeping", label: "Dọn hàng đợi việc", spec: { every: "minutes", minutes: 10 } },
  { name: "backup-upload", label: "Đưa bản sao lưu CSDL lên R2", spec: { every: "minutes", minutes: 30 } },
  { name: "alert-reminders", label: "Nhắc tin chờ trả lời quá giờ", spec: { every: "minutes", minutes: 1 } },
  { name: "alert-ai-review", label: "AI đọc lại tin để bắt tin khẩn", spec: { every: "minutes", minutes: 5 } },
  { name: "session-watch", label: "Theo dõi phiên Zalo, báo khi văng", spec: { every: "minutes", minutes: 2 } },
] as const satisfies readonly { name: string; label: string; spec: ScheduleSpec }[];

export type BackgroundTaskName = (typeof BACKGROUND_TASKS)[number]["name"];
