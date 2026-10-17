import type { Operator, SqlPart } from "../web/api/list-query.js";
import { nextVnDay, type ParsedInstant } from "./vn-time.js";

// Điều kiện cho cột ngày giờ (lưu UTC) từ mốc người gọi gửi. Mốc chỉ có NGÀY nghĩa là cả ngày giờ VN: «đúng ngày» = [đầu ngày,
// đầu ngày sau), «≤ ngày» = hết ngày đó, «> ngày» = từ ngày sau. Mốc có giờ là một thời điểm. Hàm thuần.

export function buildDateCondition(column: string, operator: Operator, values: ParsedInstant[]): SqlPart | null {
  const [first, second] = values;
  if (!first) return null;
  const start = first.date;
  const afterFirst = nextVnDay(start);
  switch (operator) {
    case "eq":
      return first.dayOnly ? { sql: `(${column} >= ? AND ${column} < ?)`, params: [start, afterFirst] } : { sql: `${column} = ?`, params: [start] };
    case "gte": return { sql: `${column} >= ?`, params: [start] };
    case "gt": return first.dayOnly ? { sql: `${column} >= ?`, params: [afterFirst] } : { sql: `${column} > ?`, params: [start] };
    case "lt": return { sql: `${column} < ?`, params: [start] };
    case "lte": return first.dayOnly ? { sql: `${column} < ?`, params: [afterFirst] } : { sql: `${column} <= ?`, params: [start] };
    case "between": {
      if (!second) return null;
      const upper = second.dayOnly ? { sql: `${column} < ?`, value: nextVnDay(second.date) } : { sql: `${column} <= ?`, value: second.date };
      return { sql: `(${column} >= ? AND ${upper.sql})`, params: [start, upper.value] };
    }
    default: return null;
  }
}

/** Cận dưới / cận trên (tính bằng mili giây epoch) một điều kiện ngày áp lên cột — để kiểm «khoảng ngày bắt buộc». */
export function dateBounds(operator: Operator, values: ParsedInstant[]): { lower?: Date; upper?: Date } {
  const [first, second] = values;
  if (!first) return {};
  switch (operator) {
    case "eq": return { lower: first.date, upper: first.dayOnly ? nextVnDay(first.date) : first.date };
    case "gte": return { lower: first.date };
    case "gt": return { lower: first.dayOnly ? nextVnDay(first.date) : first.date };
    case "lt": return { upper: first.date };
    case "lte": return { upper: first.dayOnly ? nextVnDay(first.date) : first.date };
    case "between": return second ? { lower: first.date, upper: second.dayOnly ? nextVnDay(second.date) : second.date } : {};
    default: return {};
  }
}
