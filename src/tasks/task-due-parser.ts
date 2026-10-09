import { vnLocalTime } from "../schedule/work-calendar.js";

// Đọc hạn người gõ («mai», «thứ 6», «17h thứ 6», «20/10», «cuối tuần», «tuần sau thứ 2 9h sáng») thành mốc giờ Việt Nam.
// Hạn chỉ có ngày lưu 00:00 giờ VN của ngày đó (hết ngày đó mới quá hạn — task-format.dueDeadline). Hàm thuần: KHÔNG hiểu
// hết thì trả null (nơi gọi báo lại / để trống hạn), không đoán bừa. Câu tự nhiên phức tạp hơn thì mô hình đổi ra ISO.

const DAY_MS = 86_400_000;

export interface ParsedDue {
  at: Date;
  hasTime: boolean;
}

/** Bỏ dấu, chữ thường, gọn khoảng trắng. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();
}

const WEEKDAY_WORDS: Record<string, number> = {
  "thu hai": 1, "thu 2": 1, t2: 1, "thu ba": 2, "thu 3": 2, t3: 2, "thu tu": 3, "thu 4": 3, t4: 3, "thu nam": 4, "thu 5": 4, t5: 4,
  "thu sau": 5, "thu 6": 5, t6: 5, "thu bay": 6, "thu 7": 6, t7: 6, "chu nhat": 7, cn: 7,
};

/** Giờ trong câu: «17h», «17h30», «17:30», «9 giờ sáng», «3h chiều», «9g». Trả phút trong ngày + câu đã bỏ phần giờ. */
function extractTime(text: string): { minutes: number; rest: string } | null {
  const match = text.match(/(?:^|\s)(?:luc\s+)?(\d{1,2})\s*(?:h|g|gio|:)\s*(\d{2})?(?:\s*(?:phut|p))?(?:\s+(sang|trua|chieu|toi))?(?=\s|$)/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const period = match[3];
  if ((period === "chieu" || period === "toi") && hours < 12) hours += 12;
  if (period === "trua" && hours < 11) hours += 12;
  if (hours > 23 || minutes > 59) return null;
  return { minutes: hours * 60 + minutes, rest: `${text.slice(0, match.index)} ${text.slice(match.index! + match[0].length)}`.replace(/\s+/g, " ").trim() };
}

/** 00:00 giờ VN của ngày y-m-d (tháng 1–12); null nếu ngày không tồn tại (31/02). */
function vnDay(year: number, month: number, day: number): Date | null {
  const at = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`);
  if (Number.isNaN(at.getTime())) return null;
  const local = vnLocalTime(at).date;
  return local === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` ? at : null;
}

/** Phần NGÀY (đã bỏ giờ, đã bỏ dấu). null = không hiểu. */
function parseDay(text: string, now: Date): Date | null {
  const today = vnLocalTime(now);
  const todayStart = new Date(today.dayStartMs);
  const plusDays = (days: number) => new Date(today.dayStartMs + days * DAY_MS);
  const words = text.replace(/^(han|deadline|truoc|toi da|vao|ngay)\s+/, "").replace(/^(han|ngay|vao)\s+/, "").trim()
    // «T6 18/10», «thứ 6 18/10» (đúng dạng bot in ra) — có ngày cụ thể thì bỏ thứ
    .replace(/^(thu (?:hai|ba|tu|nam|sau|bay|[2-7])|t[2-7]|chu nhat|cn)\s+(?=\d)/, "");
  if (!words || words === "hom nay" || words === "nay" || words === "trong ngay") return todayStart;
  if (words === "mai" || words === "ngay mai") return plusDays(1);
  if (words === "mot" || words === "ngay mot" || words === "ngay kia") return plusDays(2);
  if (words === "cuoi tuan" || words === "cuoi tuan nay") return plusDays((6 - today.weekday + 7) % 7);
  if (words === "cuoi thang" || words === "cuoi thang nay") {
    const [year, month] = today.date.split("-").map(Number);
    return new Date(vnDay(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1)!.getTime() - DAY_MS);
  }
  const weekday = words.match(/^(tuan (?:sau|toi) )?(thu hai|thu ba|thu tu|thu nam|thu sau|thu bay|thu [2-7]|t[2-7]|chu nhat|cn)( tuan (?:sau|toi))?$/);
  if (weekday) {
    const target = WEEKDAY_WORDS[weekday[2]];
    if (weekday[1] || weekday[3]) {
      // Tuần sau: ngày đó trong tuần lịch kế tiếp (thứ 2 – CN)
      return plusDays(7 - today.weekday + target);
    }
    // Không nói tuần nào: lần tới SAU hôm nay («thứ 6» nói vào thứ 6 = thứ 6 tuần sau)
    return plusDays(((target - today.weekday + 7) % 7) || 7);
  }
  const date = words.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (date) {
    if (date[3]) return vnDay(date[3].length === 2 ? 2000 + Number(date[3]) : Number(date[3]), Number(date[2]), Number(date[1]));
    // Không ghi năm: năm nay; đã lùi quá 7 ngày thì là năm sau («5/1» gõ ngày 28/12 = 05/01 năm sau, không phải gần một năm trước)
    const thisYear = Number(today.date.slice(0, 4));
    const candidate = vnDay(thisYear, Number(date[2]), Number(date[1]));
    if (candidate && candidate.getTime() < today.dayStartMs - 7 * DAY_MS) return vnDay(thisYear + 1, Number(date[2]), Number(date[1]));
    return candidate;
  }
  return null;
}

/** Đọc hạn. Chỉ có giờ («17h») = hôm nay lúc đó, đã qua thì ngày mai. */
export function parseDueText(input: string, now: Date): ParsedDue | null {
  const text = fold(input).replace(/[,.;!?]+$/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const time = extractTime(text);
  const dayText = time ? time.rest : text;
  const day = parseDay(dayText, now);
  if (!day) return null;
  if (!time) return { at: day, hasTime: false };
  let at = new Date(day.getTime() + time.minutes * 60_000);
  const onlyTime = !dayText.replace(/^(han|deadline|truoc|toi da|vao|ngay)\s*/, "").trim();
  if (onlyTime && at.getTime() <= now.getTime()) at = new Date(at.getTime() + DAY_MS);
  return { at, hasTime: true };
}

/** Hạn hợp lý: từ hôm qua tới 2 năm nữa — ngoài khoảng đó là gõ nhầm / mô hình bịa (review 09/10/2026: «1999-01-01» lọt qua). */
const MAX_PAST_MS = DAY_MS;
const MAX_FUTURE_MS = 2 * 366 * DAY_MS;
function plausible(due: ParsedDue | null, now: Date): ParsedDue | null {
  if (!due) return null;
  // Hạn chỉ có ngày tính tới hết ngày đó
  const deadline = due.at.getTime() + (due.hasTime ? 0 : DAY_MS);
  return deadline >= now.getTime() - MAX_PAST_MS && due.at.getTime() <= now.getTime() + MAX_FUTURE_MS ? due : null;
}

/** Hạn người gõ / mô hình truyền: chữ thường («thứ 6») hoặc ISO («2026-10-16» / «2026-10-16T17:00:00+07:00»). */
export function parseDueArgument(raw: unknown, now: Date): ParsedDue | null {
  return plausible(parseDueRaw(raw, now), now);
}

function parseDueRaw(raw: unknown, now: Date): ParsedDue | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const at = vnDay(year, month, day);
    return at ? { at, hasTime: false } : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const at = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}+07:00`);
    return Number.isNaN(at.getTime()) ? null : { at, hasTime: true };
  }
  return parseDueText(value, now);
}
