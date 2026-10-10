// Lịch làm việc theo giờ Việt Nam (UTC+7, không đổi giờ mùa): giờ làm, ngày làm, giờ yên lặng, ngày nghỉ lễ.
// Dùng cho: đồng hồ chờ «2 giờ LÀM VIỆC» (IDA câu 7), giờ yên lặng chỉ báo KHẨN / VIP (câu 7, 9), bản tin chỉ gửi ngày
// làm việc (câu 24). Mọi hàm thuần — nhận mốc giờ, trả mốc giờ; cài đặt chuỗi được kiểm bằng các hàm parse ở đây.

const VN_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;
/** Ngày hạn / kỳ rơi vào kỳ nghỉ dài (Tết) — tìm ngày làm việc liền kề trong ngần này ngày thì thôi. */
const MAX_ADJACENT_LOOKUP_DAYS = 20;

/** Khoảng giờ trong ngày, tính bằng phút từ 00:00. `end` < `start` = vắt qua nửa đêm (vd 21:00–06:30). */
export interface TimeRange {
  start: number;
  end: number;
}

/** Ngày nghỉ: lặp hằng năm (chỉ ngày/tháng) hoặc một khoảng ngày cụ thể (Tết âm lịch mỗi năm một khác). */
export type Holiday = { kind: "yearly"; day: number; month: number } | { kind: "range"; from: string; to: string };

export interface WorkCalendarConfig {
  workRanges: TimeRange[];
  /** 1 = thứ 2 … 7 = Chủ nhật. */
  workDays: number[];
  quietRanges: TimeRange[];
  holidays: Holiday[];
}

export class CalendarInputError extends Error {}

const pad = (value: number) => String(value).padStart(2, "0");

function parseClock(text: string): number {
  const match = /^(\d{1,2})[:h](\d{2})$/.exec(text.trim());
  if (!match) throw new CalendarInputError(`«${text.trim()}» không phải giờ dạng HH:MM`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) throw new CalendarInputError(`«${text.trim()}» không phải giờ hợp lệ`);
  return hours * 60 + minutes;
}

/** «08:30-12:00, 13:30-17:30» → các khoảng. `allowWrap` = cho khoảng vắt qua nửa đêm (giờ yên lặng). */
export function parseTimeRanges(text: string, allowWrap: boolean): TimeRange[] {
  const parts = text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 6) throw new CalendarInputError("tối đa 6 khoảng giờ");
  return parts.map((part) => {
    const [from, to, extra] = part.split(/\s*[-–]\s*/);
    if (!from || !to || extra !== undefined) throw new CalendarInputError(`«${part}» phải có dạng HH:MM-HH:MM`);
    const range = { start: parseClock(from), end: parseClock(to) };
    if (range.start === range.end) throw new CalendarInputError(`«${part}» bắt đầu trùng kết thúc`);
    if (range.end < range.start && !allowWrap) throw new CalendarInputError(`«${part}» kết thúc trước khi bắt đầu`);
    return range;
  });
}

/** «01/01, 30/04, 01/05, 02/09, 16/02/2027-22/02/2027» → ngày nghỉ. */
export function parseHolidays(text: string): Holiday[] {
  const parts = text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 60) throw new CalendarInputError("tối đa 60 mục ngày nghỉ");
  const toIso = (raw: string): string => {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
    if (!match) throw new CalendarInputError(`«${raw.trim()}» phải có dạng dd/mm/yyyy`);
    const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || year < 2020 || year > 2100) {
      throw new CalendarInputError(`«${raw.trim()}» không phải ngày có thật`);
    }
    return `${year}-${pad(month)}-${pad(day)}`;
  };
  return parts.map((part) => {
    const yearly = /^(\d{1,2})\/(\d{1,2})$/.exec(part);
    if (yearly) {
      const day = Number(yearly[1]);
      const month = Number(yearly[2]);
      // Năm nhuận để 29/02 cũng nhận
      const probe = new Date(Date.UTC(2024, month - 1, day));
      if (probe.getUTCDate() !== day || probe.getUTCMonth() !== month - 1) throw new CalendarInputError(`«${part}» không phải ngày có thật`);
      return { kind: "yearly", day, month };
    }
    const [from, to, extra] = part.split(/\s*[-–]\s*/);
    if (extra !== undefined) throw new CalendarInputError(`«${part}» không đọc được`);
    const range = { kind: "range" as const, from: toIso(from), to: toIso(to ?? from) };
    if (range.to < range.from) throw new CalendarInputError(`«${part}» ngày kết thúc trước ngày bắt đầu`);
    return range;
  });
}

/** Danh sách thứ trong tuần «1,2,3» → số; kiểm 1–7. */
export function parseWorkDays(values: (string | number)[]): number[] {
  const days = [...new Set(values.map(Number))].sort((a, b) => a - b);
  if (!days.length) throw new CalendarInputError("phải có ít nhất một ngày làm việc");
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new CalendarInputError("ngày trong tuần là số 1 (thứ 2) tới 7 (Chủ nhật)");
  return days;
}

/** Một mốc giờ nhìn theo giờ Việt Nam. */
interface LocalTime {
  /** «2026-10-08» */
  date: string;
  /** 1 = thứ 2 … 7 = Chủ nhật */
  weekday: number;
  minuteOfDay: number;
  /** Mốc 00:00 giờ VN của ngày đó (ms UTC) */
  dayStartMs: number;
}

function toLocal(at: Date): LocalTime {
  const shifted = at.getTime() + VN_OFFSET_MS;
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  const day = new Date(dayStartShifted);
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  return {
    date: `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`,
    weekday,
    minuteOfDay: Math.floor((shifted - dayStartShifted) / 60_000),
    dayStartMs: dayStartShifted - VN_OFFSET_MS,
  };
}

const inRange = (minute: number, range: TimeRange) =>
  range.end > range.start ? minute >= range.start && minute < range.end : minute >= range.start || minute < range.end;

export class WorkCalendar {
  private readonly workRanges: TimeRange[];

  constructor(private readonly config: WorkCalendarConfig) {
    // Khoảng giờ làm xếp theo giờ bắt đầu — addWorkingMinutes đi tuần tự
    this.workRanges = [...config.workRanges].sort((a, b) => a.start - b.start);
  }

  isHoliday(at: Date): boolean {
    const local = toLocal(at);
    const [, month, day] = local.date.split("-").map(Number);
    return this.config.holidays.some((holiday) => holiday.kind === "yearly"
      ? holiday.day === day && holiday.month === month
      : local.date >= holiday.from && local.date <= holiday.to);
  }

  /** Ngày làm việc: đúng thứ làm việc và không phải ngày nghỉ. */
  isWorkingDay(at: Date): boolean {
    return this.config.workDays.includes(toLocal(at).weekday) && !this.isHoliday(at);
  }

  isWorkingTime(at: Date): boolean {
    if (!this.isWorkingDay(at)) return false;
    const minute = toLocal(at).minuteOfDay;
    return this.workRanges.some((range) => inRange(minute, range));
  }

  /** Giờ yên lặng: trong khoảng yên lặng, HOẶC cả ngày không làm việc (Chủ nhật, lễ, Tết) — chỉ báo KHẨN / VIP. */
  isQuietTime(at: Date): boolean {
    if (!this.isWorkingDay(at)) return true;
    const minute = toLocal(at).minuteOfDay;
    return this.config.quietRanges.some((range) => inRange(minute, range));
  }

  /**
   * Cộng `minutes` phút GIỜ LÀM VIỆC vào `start` — đồng hồ chờ chỉ chạy trong giờ làm. Tin tới lúc 17:00 với ngưỡng
   * 2 giờ (giờ làm tới 17:30) thì hạn nhắc là 1 giờ 30 sau giờ vào làm của ngày làm việc kế tiếp.
   * Lịch không có giờ làm nào thì trả null (không bao giờ tới hạn).
   */
  addWorkingMinutes(start: Date, minutes: number): Date | null {
    if (!this.workRanges.length || !this.config.workDays.length) return null;
    let remaining = Math.max(0, minutes);
    let local = toLocal(start);
    // Trần 400 ngày — lịch toàn ngày nghỉ (nhập sai) không làm vòng lặp chạy mãi
    for (let guard = 0; guard < 400; guard += 1) {
      const dayStart = new Date(local.dayStartMs);
      if (this.isWorkingDay(new Date(local.dayStartMs + 12 * 60 * 60_000))) {
        for (const range of this.workRanges) {
          const end = range.end > range.start ? range.end : MINUTES_PER_DAY;
          const from = Math.max(range.start, local.minuteOfDay);
          if (from >= end) continue;
          const available = end - from;
          if (remaining <= available) return new Date(dayStart.getTime() + (from + remaining) * 60_000);
          remaining -= available;
        }
      }
      local = toLocal(new Date(local.dayStartMs + DAY_MS));
      local = { ...local, minuteOfDay: 0 };
    }
    return null;
  }

  /** Ngày làm việc liền trước ngày chứa `at` (00:00 giờ VN, KHÔNG phải đầu giờ làm). null = không tìm thấy trong tầm nhìn. */
  previousWorkingDay(at: Date, lookupDays = MAX_ADJACENT_LOOKUP_DAYS): Date | null {
    const dayStartMs = toLocal(at).dayStartMs;
    for (let back = 1; back <= lookupDays; back += 1) {
      const day = dayStartMs - back * DAY_MS;
      if (this.isWorkingDay(new Date(day + 12 * 3_600_000))) return new Date(day);
    }
    return null;
  }

  /** Đầu giờ làm của ngày làm việc liền trước (dùng cho mốc nhắc hạn — việc, phase 7). */
  previousWorkingDayStart(at: Date, lookupDays = MAX_ADJACENT_LOOKUP_DAYS): Date | null {
    const day = this.previousWorkingDay(at, lookupDays);
    return day ? this.addWorkingMinutes(day, 0) : null;
  }

  /** Ngày làm việc kế tiếp sau ngày chứa `at` (00:00 giờ VN, không tính chính ngày `at`). */
  nextWorkingDay(at: Date, lookupDays = MAX_ADJACENT_LOOKUP_DAYS): Date | null {
    const dayStartMs = toLocal(at).dayStartMs;
    for (let forward = 1; forward <= lookupDays; forward += 1) {
      const day = dayStartMs + forward * DAY_MS;
      if (this.isWorkingDay(new Date(day + 12 * 3_600_000))) return new Date(day);
    }
    return null;
  }

  /** Đầu giờ làm của ngày làm việc kế tiếp. */
  nextWorkingDayStart(at: Date, lookupDays = MAX_ADJACENT_LOOKUP_DAYS): Date | null {
    const day = this.nextWorkingDay(at, lookupDays);
    return day ? this.addWorkingMinutes(day, 0) : null;
  }
}

/** Chuỗi cài đặt → lịch. Sai thì ném CalendarInputError (câu cho người sửa cài đặt đọc). */
export function buildWorkCalendar(settings: { workHours: string; workDays: (string | number)[]; quietHours: string; holidays: string }): WorkCalendar {
  return new WorkCalendar({
    workRanges: parseTimeRanges(settings.workHours, false),
    workDays: parseWorkDays(settings.workDays),
    quietRanges: parseTimeRanges(settings.quietHours, true),
    holidays: parseHolidays(settings.holidays),
  });
}

/** Ngày giờ VN của một mốc: «2026-10-08», phút trong ngày, thứ — cho bộ lập lịch. */
export function vnLocalTime(at: Date): LocalTime {
  return toLocal(at);
}

/** «2026-10-08» → đúng 00:00 giờ VN của ngày đó (mốc UTC thật) — nghịch đảo của `vnLocalTime(...).date`. */
export function vnMidnight(dateIso: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - VN_OFFSET_MS);
}
