import { BriefKind } from "../constants.js";
import { vnLocalTime, vnMidnight, type WorkCalendar } from "../schedule/work-calendar.js";
import { mondayOfWeek } from "./brief-period.js";

// Đến hạn bản tin sáng / cuối ngày của MỘT người nhận (phase 2, chốt 09/10/2026) — hàm THUẦN, không chạm DB. Mỗi người
// nhận có giờ hẹn riêng (`recipient.morning_brief_at` / `evening_brief_at`, rỗng = tắt) nên việc nền xét từng người mỗi
// phút thay vì dùng `spec: day` của bộ lập lịch (một giờ chung cho mọi việc).
//   - Giờ hẹn không hợp lệ (rỗng / sai dạng HH:MM) → không bao giờ tới hạn (coi như tắt).
//   - Hôm nay không phải ngày làm việc (cuối tuần / lễ) → không gửi.
//   - Gửi BÙ nếu worker tắt qua giờ hẹn: sáng bù tới 12:00, cuối ngày bù tới đầu giờ yên lặng; quá mốc bù thì bỏ lượt
//     hẳn trong ngày (không gửi bản tin sáng lúc 15:00).
//
// Báo cáo tuần / tháng (phase 3) KHÔNG có giờ hẹn riêng từng người nhận (chốt 09/10/2026: «giờ báo cáo tuần / tháng
// riêng từng người» nằm ngoài phạm vi) — giờ cố định 08:00, ngày = ngày làm việc đầu tiên của tuần ISO (tuần) / từ
// ngày 3 (tháng); rơi ngày nghỉ thì dời sang ngày làm việc kế tiếp. Cùng kiểu bù tới đầu giờ yên lặng như cuối ngày.

/** 12:00 (phút trong ngày) — hết giờ bù bản tin sáng. */
const MORNING_CATCH_UP_CUTOFF_MINUTE = 12 * 60;
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** 08:00 (phút trong ngày) — giờ gửi báo cáo tuần / tháng. */
const PERIODIC_REPORT_START_MINUTE = 8 * 60;

/** «07:30» → 450 (phút từ 00:00); rỗng / sai dạng → null (tắt). Hàm thuần, tách để test riêng dễ đọc. */
export function parseDailyBriefTime(text: string): number | null {
  const match = TIME_PATTERN.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Đến lượt gửi bản tin sáng / cuối ngày chưa, tại mốc `now`. `timeSetting` = giờ hẹn của người nhận (cột
 * `morning_brief_at` / `evening_brief_at`, dạng «HH:MM», rỗng = tắt).
 */
export function isDailyBriefDue(
  kind: BriefKind.Morning | BriefKind.Evening, timeSetting: string, now: Date, calendar: WorkCalendar,
): boolean {
  const scheduledMinute = parseDailyBriefTime(timeSetting);
  if (scheduledMinute === null) return false;
  if (!calendar.isWorkingDay(now)) return false;
  const minuteNow = vnLocalTime(now).minuteOfDay;
  if (minuteNow < scheduledMinute) return false;
  if (kind === BriefKind.Morning) return minuteNow <= MORNING_CATCH_UP_CUTOFF_MINUTE;
  // Cuối ngày: bù tới đầu giờ yên lặng — qua hourMinute rồi nên isQuietTime chỉ còn lật true khi chạm mốc yên lặng
  return !calendar.isQuietTime(now);
}

/** Ngày làm việc đầu tiên TỪ `day` trở đi (chính `day` nếu đã là ngày làm việc). */
function firstWorkingDayOnOrAfter(day: Date, calendar: WorkCalendar): Date {
  return calendar.isWorkingDay(day) ? day : (calendar.nextWorkingDay(day) ?? day);
}

/** 00:00 giờ VN ngày 3 của tháng chứa `now`. */
function thirdDayOfMonth(now: Date): Date {
  const [year, month] = vnLocalTime(now).date.split("-");
  return vnMidnight(`${year}-${month}-03`);
}

/**
 * Đến hạn báo cáo tuần / tháng (hàm thuần) — 08:00 ngày làm việc đầu tiên (T2 của tuần / ngày 3 của tháng, dời sang
 * ngày làm việc kế tiếp nếu rơi ngày nghỉ), bù tới đầu giờ yên lặng nếu worker tắt qua giờ. Không có giờ hẹn riêng
 * từng người nhận — tắt / bật chung bằng `periodic_reports_enabled` (xem `brief-runner.ts`).
 */
export function isPeriodicReportDue(kind: BriefKind.Weekly | BriefKind.Monthly, now: Date, calendar: WorkCalendar): boolean {
  const anchor = kind === BriefKind.Weekly ? mondayOfWeek(now) : thirdDayOfMonth(now);
  const targetDate = vnLocalTime(firstWorkingDayOnOrAfter(anchor, calendar)).date;
  const local = vnLocalTime(now);
  if (local.date !== targetDate) return false;
  if (local.minuteOfDay < PERIODIC_REPORT_START_MINUTE) return false;
  return !calendar.isQuietTime(now);
}
