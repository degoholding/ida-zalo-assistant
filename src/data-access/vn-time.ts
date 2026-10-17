// Giờ Việt Nam (UTC+7, không đổi giờ mùa hè) cho lõi truy cập dữ liệu: đọc giờ người gọi gửi (không múi → giờ VN), trả giờ ISO
// có +07:00. Hàm thuần.

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:\d{2})?$/;

export interface ParsedInstant {
  date: Date;
  /** Chỉ có ngày («2026-10-05») → nghĩa là CẢ NGÀY VN đó. */
  dayOnly: boolean;
}

/**
 * «2026-10-05» (cả ngày VN), «2026-10-05T09:30» / «… 09:30:15.250» (không múi → giờ VN), hoặc có múi (`Z`, `+07:00`, `-05:00`).
 * Sai định dạng / ngày không có thật (30/02) → null.
 */
export function parseVnInstant(raw: string): ParsedInstant | null {
  const match = INSTANT.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millis, zone] = match;
  const dayOnly = hour === undefined;
  if (dayOnly && zone) return null;
  const parts = [Number(year), Number(month), Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0)];
  const probe = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  const real = probe.getUTCFullYear() === parts[0] && probe.getUTCMonth() === parts[1] - 1 && probe.getUTCDate() === parts[2]
    && probe.getUTCHours() === parts[3] && probe.getUTCMinutes() === parts[4];
  if (!real) return null;
  const clock = `${year}-${month}-${day}T${String(parts[3]).padStart(2, "0")}:${String(parts[4]).padStart(2, "0")}:${String(parts[5]).padStart(2, "0")}.${(millis ?? "0").padEnd(3, "0")}`;
  const date = new Date(`${clock}${zone ?? "+07:00"}`);
  return Number.isNaN(date.getTime()) ? null : { date, dayOnly };
}

export function nextVnDay(date: Date): Date {
  return new Date(date.getTime() + DAY_MS);
}

/** Số ngày (làm tròn lên) giữa hai mốc. */
export function spanDays(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

/** `2026-10-16T09:12:04+07:00` — giờ VN dạng ISO 8601 có múi. */
export function toVnIso(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS).toISOString();
  return `${local.slice(0, 19)}+07:00`;
}

/** Giá trị cột ngày giờ do mysql2 trả (Date, hoặc chuỗi nếu dateStrings) → ISO VN; không đọc được → null. */
export function dbDateToVnIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : toVnIso(date);
}

/** Như `toVnIso` nhưng giữ mili giây (`…:04.250+07:00`) — làm mốc «tiếp theo» khi phân trang theo giờ. */
export function toVnIsoMs(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS).toISOString();
  return `${local.slice(0, 23)}+07:00`;
}
