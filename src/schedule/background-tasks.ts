import type { ScheduleSpec } from "./scheduler.js";

// Danh mục việc nền chạy theo lịch — khai MỘT chỗ để tiến trình worker chạy và màn Cài đặt (tiến trình app) hiện trạng
// thái mà không phải hỏi worker. Thêm việc = thêm một dòng ở đây + một hàm chạy ở src/background.ts.

export const BACKGROUND_TASKS = [
  { name: "avatars", label: "Tải ảnh đại diện", spec: { every: "minutes", minutes: 2 } },
  { name: "retention", label: "Dọn tin và tệp gốc quá hạn giữ", spec: { every: "day", at: "02:00" } },
  { name: "job-housekeeping", label: "Dọn hàng đợi việc", spec: { every: "minutes", minutes: 10 } },
  { name: "backup-upload", label: "Đưa bản sao lưu CSDL lên R2", spec: { every: "minutes", minutes: 30 } },
] as const satisfies readonly { name: string; label: string; spec: ScheduleSpec }[];

export type BackgroundTaskName = (typeof BACKGROUND_TASKS)[number]["name"];
