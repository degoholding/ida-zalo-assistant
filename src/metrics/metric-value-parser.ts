// Đọc một ô bảng thành ngày / số. Hàm thuần. Bảng đọc ở dạng UNFORMATTED_VALUE nên phần lớn ô đã là số thật; nhánh đọc chữ
// dành cho ô NV gõ tay («1.234.567», «1,2tr», «500k», «12/10»).

const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** Serial hợp lý: từ ~2000 đến ~2100 (tránh nhận nhầm số 1.234.567 là ngày). */
const SERIAL_MIN = 36_526;
const SERIAL_MAX = 73_050;

const pad2 = (n: number) => String(n).padStart(2, "0");

function validDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Số serial của Sheets, «dd/mm/yyyy», «d/m/yy», «yyyy-mm-dd» → «YYYY-MM-DD»; sai → null. */
export function parseSheetDate(cell: unknown): string | null {
  if (typeof cell === "number") {
    if (!Number.isFinite(cell) || cell < SERIAL_MIN || cell > SERIAL_MAX) return null;
    return new Date(SERIAL_EPOCH_MS + Math.floor(cell) * DAY_MS).toISOString().slice(0, 10);
  }
  if (typeof cell !== "string") return null;
  const text = cell.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return validDate(year, Number(match[2]), Number(match[1]));
}

export type ParsedNumber = { value: number } | { unparsed: true; raw: string };

const SUFFIXES: { pattern: RegExp; factor: number }[] = [
  { pattern: /(triệu|trieu|tr)$/, factor: 1e6 },
  { pattern: /(nghìn|nghin|ngàn|ngan|k)$/, factor: 1e3 },
];

/** Tách phần số: «1.234.567», «1,234,567», «1,5», «1.5» → số; không đọc được → null. */
function parseDigits(body: string, hasSuffix: boolean): number | null {
  if (!/^\d[\d.,]*$/.test(body)) return null;
  const dots = body.split(".").length - 1;
  const commas = body.split(",").length - 1;
  let normalized: string;
  if (dots && commas) {
    // Cả hai: dấu đứng sau cùng là dấu thập phân
    const decimalSep = body.lastIndexOf(".") > body.lastIndexOf(",") ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = body.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (dots > 1 || commas > 1) {
    normalized = body.replace(/[.,]/g, "");
  } else if (dots === 1 || commas === 1) {
    const sep = dots ? "." : ",";
    const [head, tail] = body.split(sep);
    // «1.234» không hậu tố = hàng nghìn kiểu VN; có hậu tố («1.5tr») hoặc phần sau ≠ 3 chữ số = thập phân
    const thousands = !hasSuffix && tail.length === 3 && head.length <= 3 && head !== "0";
    normalized = thousands ? head + tail : `${head}.${tail}`;
  } else {
    normalized = body;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Ô → số. Ô trống → null (bỏ qua). Không đọc được → `{ unparsed, raw }` (giữ chữ gốc, KHÔNG thành 0). */
/** Trần giá trị (cột metric_value.value DECIMAL(18,2) chứa tối đa 16 chữ số phần nguyên — chừa biên cho phép cộng dồn). */
const VALUE_LIMIT = 1e15;

export function parseVnNumber(cell: unknown): ParsedNumber | null {
  if (cell === null || cell === undefined) return null;
  // Ô số (Sheets trả UNFORMATTED_VALUE nên đa số ô là số) cũng phải qua trần DECIMAL(18,2) — số khổng lồ lọt vào làm cả lô INSERT
  // của nguồn lỗi «out of range» mỗi lượt đọc
  if (typeof cell === "number") {
    return Number.isFinite(cell) && Math.abs(cell) < VALUE_LIMIT ? { value: Math.round(cell * 100) / 100 } : { unparsed: true, raw: String(cell).slice(0, 100) };
  }
  if (typeof cell === "boolean") return { unparsed: true, raw: String(cell) };
  const raw = String(cell).trim();
  if (!raw) return null;
  let text = raw.toLowerCase().replace(/\s+/g, "").replace(/đ$|vnd$|vnđ$/, "");
  let negative = false;
  const paren = /^\((.+)\)$/.exec(text);
  if (paren) {
    negative = true;
    text = paren[1];
  }
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = !negative;
    text = text.slice(1);
  }
  let factor = 1;
  for (const suffix of SUFFIXES) {
    if (suffix.pattern.test(text)) {
      factor = suffix.factor;
      text = text.replace(suffix.pattern, "");
      break;
    }
  }
  const digits = parseDigits(text, factor !== 1);
  if (digits === null) return { unparsed: true, raw: raw.slice(0, 100) };
  const value = digits * factor * (negative ? -1 : 1);
  // DECIMAL(18,2): quá lớn coi như không đọc được
  return Math.abs(value) >= VALUE_LIMIT ? { unparsed: true, raw: raw.slice(0, 100) } : { value: Math.round(value * 100) / 100 };
}
