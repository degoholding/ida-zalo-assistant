import { MetricFlag } from "../constants.js";

// Cờ số liệu — hàm thuần. Cờ Unparsed / UnknownStaff do bộ đọc dòng gán sẵn (baseFlags); ở đây thêm Negative và Deviation.

/** Lệch quá ±30% so với kỳ trước (IDA câu 15). */
export const DEVIATION_THRESHOLD = 0.3;
/** «Kỳ trước» = ngày gần nhất có số trong ngần này ngày. */
export const DEVIATION_LOOKBACK_DAYS = 31;
const DAY_MS = 86_400_000;

export interface FlagInput {
  /** Nhận diện dòng để map kết quả về (id DB hoặc chỉ số) */
  id: number | string;
  /** Khóa nhóm: cùng (nhân viên, khu vực, chỉ tiêu) */
  groupKey: string;
  date: string;
  value: number | null;
  baseFlags: number;
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/** Trả Map id → cờ đầy đủ (baseFlags | Negative | Deviation). */
export function computeFlags(rows: FlagInput[]): Map<number | string, number> {
  const result = new Map<number | string, number>();
  const groups = new Map<string, FlagInput[]>();
  for (const row of rows) {
    const list = groups.get(row.groupKey) ?? [];
    list.push(row);
    groups.set(row.groupKey, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let previous: FlagInput | null = null;
    for (const row of list) {
      let flags = row.baseFlags;
      if (row.value !== null) {
        if (row.value < 0) flags |= MetricFlag.Negative;
        if (previous && previous.value !== null && previous.value !== 0
          && dayNumber(row.date) - dayNumber(previous.date) <= DEVIATION_LOOKBACK_DAYS
          && Math.abs(row.value - previous.value) / Math.abs(previous.value) > DEVIATION_THRESHOLD) {
          flags |= MetricFlag.Deviation;
        }
        previous = row;
      }
      result.set(row.id, flags);
    }
  }
  return result;
}
