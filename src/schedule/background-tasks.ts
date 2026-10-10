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
  // Chép xong thì mỗi lượt chỉ còn một câu đọc mốc — để chạy mãi không tốn gì
  { name: "search-index", label: "Chép tin cũ vào bảng tìm tin", spec: { every: "minutes", minutes: 1 } },
  { name: "task-reminders", label: "Nhắc hạn việc trong checklist", spec: { every: "minutes", minutes: 1 } },
  { name: "task-extract", label: "AI bắt câu giao việc trong nhóm", spec: { every: "minutes", minutes: 5 } },
  { name: "briefs", label: "Gửi bản tin / báo cáo", spec: { every: "minutes", minutes: 1 } },
  { name: "meeting-recordings", label: "Theo dõi ghi âm họp (Drive)", spec: { every: "minutes", minutes: 5 } },
  // Xử lý nhanh ghi âm Queued (gỡ băng) — riêng, không quét Drive — để recap gọi bằng chat (phase 6) được nhận trong
  // ≤ 1 phút thay vì chờ tới lượt quét 5 phút kế tiếp; claimNext giành bằng UPDATE có điều kiện nên không xử lý trùng
  // với "meeting-recordings" ở trên.
  { name: "meeting-recap-process", label: "Xử lý nhanh ghi âm đã xếp hàng (recap)", spec: { every: "minutes", minutes: 1 } },
] as const satisfies readonly { name: string; label: string; spec: ScheduleSpec }[];

export type BackgroundTaskName = (typeof BACKGROUND_TASKS)[number]["name"];
