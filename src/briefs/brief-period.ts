import { BriefKind } from "../constants.js";
import { vnLocalTime, vnMidnight, type WorkCalendar } from "../schedule/work-calendar.js";
import type { BriefPeriod } from "./brief-types.js";

// Kỳ dữ liệu của một bản tin / báo cáo — hàm thuần (không đọc DB). `now` là giờ soạn (giờ hẹn theo lịch hoặc giờ gọi
// tay). `to` không bao gồm (nửa khoảng mở `[from, to)`) để khớp các câu SQL `>= from AND < to` của bộ gom.
//   sáng    = 00:00 ngày LÀM VIỆC liền trước (bỏ qua cuối tuần / lễ) → giờ soạn.
//   cuối ngày = 00:00 HÔM NAY → giờ soạn.
//   tuần    = T2–CN tuần ISO TRƯỚC (biến thể «kỳ này» = T2 tuần này → giờ soạn).
//   tháng   = tháng TRƯỚC (biến thể «kỳ này» = ngày 1 tháng này → giờ soạn).
// variant "current" chỉ đổi cách tính tuần / tháng — dùng khi gọi tay «báo cáo kỳ này» (phase 4).

const DAY_MS = 86_400_000;

export type BriefPeriodVariant = "standard" | "current";

const pad2 = (value: number) => String(value).padStart(2, "0");
/** «dd/mm» theo giờ VN — chỉ lấy phần ngày/tháng, không quan tâm giờ trong ngày. */
const ddmm = (at: Date): string => {
  const [, month, day] = vnLocalTime(at).date.split("-");
  return `${day}/${month}`;
};

/** Thứ 2 (00:00 giờ VN) của tuần chứa `at` — dùng chung với `isPeriodicReportDue` (brief-due.ts, review phase 8, Low). */
export function mondayOfWeek(at: Date): Date {
  const local = vnLocalTime(at);
  return new Date(local.dayStartMs - (local.weekday - 1) * DAY_MS);
}

/** Số tuần ISO + năm ISO của một mốc (quy về ngày giờ VN trước khi tính — năm ISO có thể khác năm dương lịch). */
function isoWeek(at: Date): { year: number; week: number } {
  const [y, m, d] = vnLocalTime(at).date.split("-").map(Number);
  const thursday = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (thursday.getUTCDay() + 6) % 7; // 0 = thứ 2 … 6 = chủ nhật
  thursday.setUTCDate(thursday.getUTCDate() - dayNum + 3); // nhảy tới thứ 5 cùng tuần ISO
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year: thursday.getUTCFullYear(), week };
}

/** Ngày 1 (00:00 giờ VN) của tháng chứa `anchorIso`, cộng/trừ `offsetMonths` tháng (âm = lùi về trước). */
function monthStart(anchorIso: string, offsetMonths: number): Date {
  const [y, m] = anchorIso.split("-").map(Number);
  const total = m - 1 + offsetMonths;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  return vnMidnight(`${year}-${pad2(month + 1)}-01`);
}

function dailyPeriod(kind: BriefKind.Morning | BriefKind.Evening, now: Date, calendar: WorkCalendar): BriefPeriod {
  const todayStart = new Date(vnLocalTime(now).dayStartMs);
  const from = kind === BriefKind.Morning ? (calendar.previousWorkingDay(now) ?? todayStart) : todayStart;
  const [year, month, day] = vnLocalTime(now).date.split("-");
  return {
    from, to: now,
    periodKey: vnLocalTime(now).date,
    periodLabel: `Ngày ${day}/${month}/${year}`,
    previous: { from: calendar.previousWorkingDay(from) ?? from, to: from },
  };
}

function weeklyPeriod(now: Date, variant: BriefPeriodVariant): BriefPeriod {
  const thisMonday = mondayOfWeek(now);
  const from = variant === "current" ? thisMonday : new Date(thisMonday.getTime() - 7 * DAY_MS);
  const to = variant === "current" ? now : thisMonday;
  const { year, week } = isoWeek(from);
  const sunday = new Date(to.getTime() - DAY_MS);
  return {
    from, to,
    periodKey: `${year}-W${pad2(week)}`,
    periodLabel: `Tuần ${week}/${year} (${ddmm(from)}–${ddmm(sunday)})`,
    previous: { from: new Date(from.getTime() - 7 * DAY_MS), to: from },
  };
}

function monthlyPeriod(now: Date, variant: BriefPeriodVariant): BriefPeriod {
  const nowDate = vnLocalTime(now).date;
  const thisMonthStart = monthStart(nowDate, 0);
  const from = variant === "current" ? thisMonthStart : monthStart(nowDate, -1);
  const to = variant === "current" ? now : thisMonthStart;
  const [year, month] = vnLocalTime(from).date.split("-");
  return {
    from, to,
    periodKey: `${year}-${month}`,
    periodLabel: `Tháng ${Number(month)}/${year}`,
    previous: { from: monthStart(vnLocalTime(from).date, -1), to: from },
  };
}

/** Kỳ dữ liệu của bản tin / báo cáo theo loại — xem ghi chú đầu tệp cho ý nghĩa từng loại. */
export function briefPeriod(kind: BriefKind, now: Date, calendar: WorkCalendar, variant: BriefPeriodVariant = "standard"): BriefPeriod {
  switch (kind) {
    case BriefKind.Morning:
    case BriefKind.Evening:
      return dailyPeriod(kind, now, calendar);
    case BriefKind.Weekly:
      return weeklyPeriod(now, variant);
    case BriefKind.Monthly:
      return monthlyPeriod(now, variant);
    default:
      throw new Error(`briefPeriod: loại bản tin không hỗ trợ (${kind})`);
  }
}
