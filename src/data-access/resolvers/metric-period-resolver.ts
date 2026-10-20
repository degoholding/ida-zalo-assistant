import { vnLocalTime } from "../../schedule/work-calendar.js";
import type { ComparisonUnit } from "../../metrics/metric-comparison-period.js";

// Phân giải KỲ CHỮ («hôm nay», «tuần này», «tháng trước», tùy chọn từ / đến) ra khoảng ngày theo giờ VN. Hàm thuần, phụ thuộc `now` của
// lượt — nên «hôm nay» của trợ lý và của MCP ngoài cùng một mốc.

export const METRIC_PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"] as const;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export interface QueryPeriod {
  from: string;
  to: string;
  label: string;
  /** Đơn vị kỳ để chọn kỳ so sánh (tuần / tháng); vắng = ngày lẻ / tùy chọn (cùng độ dài liền trước). */
  unit?: ComparisonUnit;
}

/**
 * Kỳ → khoảng ngày theo giờ VN (tuần T2–CN). «Tuần này / tháng này» CHƯA TRỌN nên chỉ tính tới hôm nay — kỳ so là cùng số ngày của
 * tuần / tháng trước (`comparisonPeriod`). `error` khi tham số sai.
 */
export function resolveQueryPeriod(args: Record<string, unknown>, now: Date): QueryPeriod | { error: string } {
  const today = vnLocalTime(now);
  const todayMs = dayMs(today.date);
  const period = typeof args.period === "string" && args.period ? args.period : "today";
  const vn = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const range = (fromMs: number, toMs: number, name: string, unit?: ComparisonUnit): QueryPeriod => ({
    from: isoOf(fromMs), to: isoOf(toMs), label: `${name} (${vn(isoOf(fromMs))} – ${vn(isoOf(toMs))})`, ...(unit ? { unit } : {}),
  });
  const weekStart = todayMs - (today.weekday - 1) * DAY_MS;
  const monthStartOf = (offset: number) => { const d = new Date(todayMs); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1); };
  switch (period) {
    case "today": return range(todayMs, todayMs, "hôm nay");
    case "yesterday": return range(todayMs - DAY_MS, todayMs - DAY_MS, "hôm qua");
    case "this_week": return range(weekStart, todayMs, "tuần này", "week");
    case "last_week": return range(weekStart - 7 * DAY_MS, weekStart - DAY_MS, "tuần trước", "week");
    case "this_month": return range(monthStartOf(0), todayMs, "tháng này", "month");
    case "last_month": return range(monthStartOf(-1), monthStartOf(0) - DAY_MS, "tháng trước", "month");
    case "custom": {
      const from = typeof args.from === "string" ? args.from.trim() : "";
      const to = typeof args.to === "string" && args.to.trim() ? args.to.trim() : from;
      if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || Number.isNaN(dayMs(from)) || Number.isNaN(dayMs(to))) return { error: "Kỳ tùy chọn cần from / to dạng YYYY-MM-DD." };
      if (dayMs(to) < dayMs(from)) return { error: "Ngày kết thúc đứng trước ngày bắt đầu." };
      if (dayMs(to) - dayMs(from) > 366 * DAY_MS) return { error: "Kỳ tối đa 366 ngày." };
      return range(dayMs(from), dayMs(to), "kỳ chọn");
    }
    default: return { error: `period không hợp lệ (${period}); dùng: ${METRIC_PERIODS.join(", ")}.` };
  }
}
