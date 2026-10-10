import type { WorkCalendar } from "./work-calendar.js";

// Giờ yên lặng / ngày nghỉ: hoãn một tin đề xuất (việc AI bắt được, phase 7; recap họp, phase 4 recap từ Drive) tới
// đầu giờ làm kế tiếp — nhóm / người nhận không bị làm phiền ngoài giờ làm. Dùng chung cho mọi lượt đề xuất tự động
// (trước đây chỉ có ở task-proposals.ts, tách ra đây để meeting-recap-delivery.ts dùng lại).

/** `calendar` null (lịch cài sai) = không hoãn — gửi ngay còn hơn im lặng mãi. Hàm thuần theo lịch đã dựng sẵn. */
export function quietDelayMs(calendar: WorkCalendar | null, now: Date): number {
  if (!calendar?.isQuietTime(now)) return 0;
  const next = calendar.addWorkingMinutes(now, 0);
  return next ? Math.max(0, next.getTime() - now.getTime()) : 0;
}
