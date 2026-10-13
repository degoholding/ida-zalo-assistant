import { foldText } from "../alerts/keyword-matcher.js";
import type { MetricAggregate, MetricDef, MetricMapping } from "./metric-types.js";

// Ánh xạ cột của một nguồn số liệu (cột metric_source.mapping, JSON):
//   { "date": "Ngày", "staff": "Nhân viên", "staff_by": "name", "area": "Khu vực",
//     "metrics": [ { "code": "doanh_so", "label": "Doanh số", "column": "Doanh số (đ)", "unit": "đ", "aggregate": "sum" } ] }
// Cột = chữ tiêu đề (so gấp dấu) HOẶC chữ cột A…ZZ.

const CODE_PATTERN = /^[a-z0-9_]{2,40}$/;
const COLUMN_LETTER = /^[A-Za-z]{1,2}$/;
const MAX_METRICS = 20;
const MAX_COLUMN_INDEX = 26 * 27 - 1; // ZZ

export type MappingResult = { ok: true; mapping: MetricMapping } | { ok: false; error: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Kiểm cấu hình ánh xạ người dùng nhập; lỗi là câu tiếng Việt nói rõ chỗ sai. */
export function validateMapping(raw: unknown): MappingResult {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Ánh xạ cột không phải JSON hợp lệ." };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Chưa có ánh xạ cột." };
  const source = value as Record<string, unknown>;
  const date = text(source.date);
  const staff = text(source.staff);
  if (!date) return { ok: false, error: "Ánh xạ thiếu cột «Ngày» (date)." };
  if (!staff) return { ok: false, error: "Ánh xạ thiếu cột «Nhân viên» (staff)." };
  const staffBy = source.staff_by === undefined || source.staff_by === "" ? "name" : source.staff_by;
  if (staffBy !== "name" && staffBy !== "code") return { ok: false, error: "staff_by chỉ nhận «name» hoặc «code»." };
  const metricsRaw = source.metrics;
  if (!Array.isArray(metricsRaw) || metricsRaw.length < 1 || metricsRaw.length > MAX_METRICS) {
    return { ok: false, error: `Cần từ 1 đến ${MAX_METRICS} chỉ tiêu (metrics).` };
  }
  const metrics: MetricDef[] = [];
  const seen = new Set<string>();
  for (const [index, item] of metricsRaw.entries()) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const code = text(entry.code);
    const column = text(entry.column);
    const where = `Chỉ tiêu thứ ${index + 1}`;
    if (!CODE_PATTERN.test(code)) return { ok: false, error: `${where}: mã (code) gồm 2–40 ký tự a–z, 0–9, gạch dưới.` };
    if (seen.has(code)) return { ok: false, error: `${where}: mã «${code}» bị trùng.` };
    if (!column) return { ok: false, error: `${where} («${code}») thiếu cột (column).` };
    const aggregate: MetricAggregate = entry.aggregate === undefined || entry.aggregate === "" ? "sum" : entry.aggregate as MetricAggregate;
    if (aggregate !== "sum" && aggregate !== "last") return { ok: false, error: `${where} («${code}»): aggregate chỉ nhận «sum» hoặc «last».` };
    seen.add(code);
    metrics.push({ code, label: text(entry.label).slice(0, 80) || code, column, unit: text(entry.unit).slice(0, 20), aggregate });
  }
  return { ok: true, mapping: { date, staff, staffBy, area: text(source.area) || null, metrics } };
}

/** Chữ cột «A»…«ZZ» → chỉ số từ 0; không phải chữ cột → -1. */
export function columnLetterToIndex(letters: string): number {
  if (!COLUMN_LETTER.test(letters)) return -1;
  const index = [...letters.toUpperCase()].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return index <= MAX_COLUMN_INDEX ? index : -1;
}

export interface ResolvedColumns {
  date: number;
  staff: number;
  area: number | null;
  metrics: { def: MetricDef; index: number }[];
  /** Tiêu đề thấy được ở dòng tiêu đề — cho nút «Kiểm tra đọc thử» */
  headers: string[];
}

export type ColumnsResult = { ok: true; columns: ResolvedColumns } | { ok: false; error: string };

/** Tiêu đề khớp trước (so gấp dấu, bỏ khoảng trắng thừa); không có thì thử hiểu là chữ cột. */
function findColumn(spec: string, folded: string[]): number {
  const wanted = foldText(spec);
  const byHeader = folded.indexOf(wanted);
  if (byHeader >= 0) return byHeader;
  return columnLetterToIndex(spec);
}

/** Dòng tiêu đề + ánh xạ → chỉ số cột, hoặc câu lỗi «Không thấy cột «X» ở dòng tiêu đề N — có: …». */
export function resolveColumns(headerRow: unknown[], mapping: MetricMapping, headerRowNumber = 1): ColumnsResult {
  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  const folded = headers.map(foldText);
  const present = headers.filter(Boolean).slice(0, 12).join(", ") || "(dòng trống)";
  const need = (spec: string, role: string): number | string => {
    const index = findColumn(spec, folded);
    if (index < 0) return `Không thấy cột «${spec}» (${role}) ở dòng tiêu đề ${headerRowNumber} — có: ${present}.`;
    return index;
  };
  const date = need(mapping.date, "ngày");
  const staff = need(mapping.staff, "nhân viên");
  for (const result of [date, staff]) if (typeof result === "string") return { ok: false, error: result };
  let area: number | null = null;
  if (mapping.area) {
    const found = need(mapping.area, "khu vực");
    if (typeof found === "string") return { ok: false, error: found };
    area = found;
  }
  const metrics: ResolvedColumns["metrics"] = [];
  for (const def of mapping.metrics) {
    const index = need(def.column, `chỉ tiêu ${def.code}`);
    if (typeof index === "string") return { ok: false, error: index };
    metrics.push({ def, index });
  }
  return { ok: true, columns: { date: date as number, staff: staff as number, area, metrics, headers } };
}
