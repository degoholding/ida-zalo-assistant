// Kỳ so sánh của số liệu (% đổi, mũi tên) — hàm THUẦN, ngày «YYYY-MM-DD». Dùng chung cho công cụ AI `query_metrics`, màn web «Số liệu»,
// báo cáo tuần / tháng (review phase 10, 12/10/2026):
//   - kỳ CHƯA TRỌN (tháng này / tuần này / «kỳ này») so CÙNG SỐ NGÀY của kỳ trước tính tới hôm nay: 01–12/10 so 01–12/09; tuần T2–T4
//     so T2–T4 tuần trước — không so với cả tháng trước hay 30 ngày liền trước (kỳ chưa trọn luôn «tụt» giả).
//   - kỳ TRỌN: tháng trọn so tháng trọn trước (tháng 9 so cả tháng 8, không phải 30 ngày); tuần trọn so tuần trước.
//   - ngày lẻ / khoảng tùy chọn: cùng độ dài, liền ngay trước (luật phase 4 — `previousPeriod`).

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export interface DayRange {
  from: string;
  to: string;
}

export type ComparisonUnit = "day" | "week" | "month";

/** Kỳ trước = cùng độ dài, liền ngay trước `from` (luật phase 4, giữ nguyên cho ngày lẻ / khoảng tùy chọn). */
export function previousPeriod(from: string, to: string): DayRange {
  const length = dayNumber(to) - dayNumber(from) + 1;
  return { from: isoOf(dayNumber(from) - length), to: isoOf(dayNumber(from) - 1) };
}

/** Số ngày của tháng (`month` 1–12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Thứ trong tuần theo ISO: 1 = T2 … 7 = CN. */
function isoWeekday(iso: string): number {
  return ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function inferUnit(from: string, to: string): ComparisonUnit {
  const length = dayNumber(to) - dayNumber(from) + 1;
  if (length >= 2 && from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7)) return "month";
  if (length >= 2 && length <= 7 && isoWeekday(from) === 1) return "week";
  return "day";
}

export interface ComparisonOptions {
  /** Đơn vị kỳ do nơi gọi biết chắc (tuần này / tháng này…); bỏ trống thì suy từ khoảng ngày. */
  unit?: ComparisonUnit;
  /** Hôm nay (giờ VN) — kỳ kéo quá hôm nay (vd «tháng này» 01–31/10 khi mới 12/10) được cắt tới hôm nay trước khi so. */
  today?: string;
}

/** Kỳ so sánh của khoảng [from, to] — xem luật ở đầu tệp. */
export function comparisonPeriod(from: string, to: string, options: ComparisonOptions = {}): DayRange {
  const { today } = options;
  const end = today && to > today && from <= today ? today : to;
  const unit = options.unit ?? inferUnit(from, end);
  if (unit === "week") return { from: isoOf(dayNumber(from) - 7), to: isoOf(dayNumber(end) - 7) };
  if (unit === "month" && from.endsWith("-01")) {
    const [year, month] = from.split("-").map(Number);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevDays = daysInMonth(prevYear, prevMonth);
    const [endYear, endMonth, endDay] = end.split("-").map(Number);
    // Kỳ tới hết tháng (tháng trọn) → cả tháng trước; chưa trọn → cùng số ngày (cắt theo độ dài tháng trước)
    const fullMonth = endDay === daysInMonth(endYear, endMonth);
    const lastDay = fullMonth ? prevDays : Math.min(endDay, prevDays);
    const prefix = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, "0")}` };
  }
  return previousPeriod(from, end);
}
