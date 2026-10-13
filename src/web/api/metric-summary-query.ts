import type { RowDataPacket } from "mysql2";
import { CatalogKind, MetricFlag } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { aggregateMetrics, comparisonPeriod, listMetricCatalog, type MetricGroupBy } from "../../metrics/metric-query-service.js";
import { vnLocalTime } from "../../schedule/work-calendar.js";
import { ApiError } from "./api-http.js";

// Truy vấn cho màn «Số liệu»: tổng hợp (thêm % đổi + số cờ), ô lọc (khu vực / nhân viên), ngày hợp lệ. Lõi gom nhóm ở
// src/metrics/ — ở đây chỉ phần riêng của màn web.

export const MAX_RANGE_DAYS = 366;
const ANY_FLAG = MetricFlag.Negative | MetricFlag.Deviation | MetricFlag.Unparsed | MetricFlag.UnknownStaff;
const DAY_MS = 86_400_000;
const GROUPS = new Set<string>(["staff", "area", "date"]);

/** «YYYY-MM-DD» có thật (không nhận 2026-02-30); sai → 422. */
export function parseIsoDay(raw: string | null, label: string): string {
  const text = (raw ?? "").trim();
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  if (!ok) throw new ApiError(422, "validation_error", `${label} không hợp lệ (cần dạng năm-tháng-ngày)`);
  return text;
}

export interface SummaryParams {
  codes: string[];
  from: string;
  to: string;
  areaKey?: string;
  catalogEntryId?: number;
  groupBy: Extract<MetricGroupBy, "staff" | "area" | "date">;
}

export function parseSummaryParams(query: URLSearchParams): SummaryParams {
  const codes = (query.get("metric") ?? "").split(",").map((code) => code.trim()).filter(Boolean).slice(0, 20);
  if (codes.length === 0) throw new ApiError(422, "validation_error", "Chưa chọn chỉ tiêu");
  const from = parseIsoDay(query.get("from"), "Ngày bắt đầu");
  const to = parseIsoDay(query.get("to"), "Ngày kết thúc");
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  if (days < 1) throw new ApiError(422, "validation_error", "Ngày kết thúc phải sau hoặc trùng ngày bắt đầu");
  if (days > MAX_RANGE_DAYS) throw new ApiError(422, "validation_error", `Chỉ xem tối đa ${MAX_RANGE_DAYS} ngày một lần`);
  const groupBy = query.get("group_by") ?? "staff";
  if (!GROUPS.has(groupBy)) throw new ApiError(422, "validation_error", "Cách gộp chỉ nhận staff, area hoặc date");
  const staff = query.get("staff");
  const catalogEntryId = staff ? Number(staff) : undefined;
  if (catalogEntryId !== undefined && !Number.isSafeInteger(catalogEntryId)) throw new ApiError(422, "validation_error", "Nhân viên không hợp lệ");
  return { codes, from, to, areaKey: query.get("area") || undefined, catalogEntryId, groupBy: groupBy as SummaryParams["groupBy"] };
}

const GROUP_KEY_SQL: Record<SummaryParams["groupBy"], string> = {
  staff: "v.staff_key", area: "v.area_key", date: "DATE_FORMAT(v.metric_date, '%Y-%m-%d')",
};

/** Số dòng có cờ trong kỳ, theo từng nhóm — cùng bộ lọc với `aggregateMetrics`. */
async function countFlagged(db: Db, params: SummaryParams): Promise<Map<string, number>> {
  const where = ["s.is_active = 1", "v.metric_date BETWEEN ? AND ?", `v.metric_code IN (${params.codes.map(() => "?").join(",")})`, `(v.flags & ${ANY_FLAG}) <> 0`];
  const values: unknown[] = [params.from, params.to, ...params.codes];
  if (params.areaKey !== undefined) { where.push("v.area_key = ?"); values.push(params.areaKey); }
  if (params.catalogEntryId !== undefined) { where.push("v.catalog_entry_id = ?"); values.push(params.catalogEntryId); }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${GROUP_KEY_SQL[params.groupBy]} AS group_key, COUNT(*) AS n FROM metric_value v JOIN metric_source s ON s.id = v.source_id
     WHERE ${where.join(" AND ")} GROUP BY group_key`, values);
  return new Map(rows.map((row) => [String(row.group_key), Number(row.n)]));
}

/** % đổi của tổng; kỳ trước = 0 hoặc không có thì null (không chia cho 0). */
export function changePercent(total: number, previousTotal: number): number | null {
  return previousTotal === 0 ? null : Math.round(((total - previousTotal) / Math.abs(previousTotal)) * 1000) / 10;
}

export async function buildSummary(db: Db, params: SummaryParams, now: Date = new Date()): Promise<Record<string, unknown>> {
  // Kỳ chưa trọn (tháng này / tuần này kéo quá hôm nay) so cùng số ngày của kỳ trước — xem metric-comparison-period.ts
  const compare = params.groupBy === "date" ? null : comparisonPeriod(params.from, params.to, { today: vnLocalTime(now).date });
  const [result, flagged, catalog] = await Promise.all([
    aggregateMetrics(db, { ...params, compare }), countFlagged(db, params), listMetricCatalog(db),
  ]);
  const items = catalog.filter((item) => params.codes.includes(item.code));
  const lastOk = items.map((item) => item.lastOkAt).filter((at): at is Date => at !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const rows = result.rows.map((row) => ({
    key: row.key, label: row.label, value: row.value, previous: row.previous, change_pct: row.changePct, flag_count: flagged.get(row.key) ?? 0,
  }));
  return {
    rows, previous_period: compare,
    total: {
      value: result.total, previous: params.groupBy === "date" ? null : result.previousTotal,
      change_pct: params.groupBy === "date" ? null : changePercent(result.total, result.previousTotal),
      flag_count: [...flagged.values()].reduce((sum, n) => sum + n, 0),
    },
    // Chỉ có nghĩa khi lọc đúng một chỉ tiêu (cộng nhiều đơn vị khác nhau là vô nghĩa)
    single_metric: params.codes.length === 1,
    unit: items.length === 1 ? items[0].unit : "",
    sources: [...new Set(items.map((item) => item.sourceName))], last_ok_at: lastOk,
  };
}

/** Ô lọc: khu vực có số trong 62 ngày gần nhất + nhân viên trong danh mục đang dùng. */
export async function listFilterOptions(db: Db): Promise<{ areas: { key: string; name: string }[]; staff: { id: number; name: string; region: string }[] }> {
  const [areas] = await db.query<RowDataPacket[]>(
    `SELECT v.area_key, MAX(v.area_name) AS area_name FROM metric_value v JOIN metric_source s ON s.id = v.source_id
     WHERE s.is_active = 1 AND v.area_key <> '' AND v.metric_date >= DATE_SUB(CURDATE(), INTERVAL 62 DAY) GROUP BY v.area_key ORDER BY area_name`);
  const [staff] = await db.query<RowDataPacket[]>(
    "SELECT id, name, region FROM catalog_entry WHERE kind = ? AND is_active = 1 ORDER BY name LIMIT 1000", [CatalogKind.Staff]);
  return {
    areas: areas.map((row) => ({ key: String(row.area_key), name: String(row.area_name) })),
    staff: staff.map((row) => ({ id: Number(row.id), name: String(row.name), region: String(row.region ?? "") })),
  };
}

/** Người quản lý của từng nhân viên (qua `owner_entry_id`) — cho tab «Chưa báo». */
export async function loadManagerNames(db: Db, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT e.id, o.name AS manager FROM catalog_entry e JOIN catalog_entry o ON o.id = e.owner_entry_id WHERE e.id IN (?)", [ids]);
  return new Map(rows.map((row) => [Number(row.id), String(row.manager)]));
}
