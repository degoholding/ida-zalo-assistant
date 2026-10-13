import { MetricFlag } from "../../constants.js";
import { listMetricCatalog } from "../../metrics/metric-query-service.js";
import { listMissingReporters, type ReporterRef } from "../../metrics/metric-missing-reporters.js";
import { vnLocalTime } from "../../schedule/work-calendar.js";
import { sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import type { Operator, SqlPart, ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";
import { buildSummary, listFilterOptions, loadManagerNames, parseIsoDay, parseSummaryParams } from "./metric-summary-query.js";

// Màn web «Số liệu» (phase 8, phase 10): CHỈ ĐỌC, quyền `metric.read` (Quản trị + Quản lý). Nhân viên gọi → 403 ở route-permissions.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}/;
const ALL_FLAGS = MetricFlag.Negative | MetricFlag.Deviation | MetricFlag.Unparsed | MetricFlag.UnknownStaff;

/** Lọc `metric_date` (cột DATE, so theo chuỗi ngày — không dính múi giờ). Đầu vào «YYYY-MM-DD…» hoặc bỏ lọc. */
export function buildMetricDateCondition(operator: Operator, values: string[]): SqlPart | null {
  const days = values.map((value) => (DAY_PATTERN.test(value) ? value.slice(0, 10) : ""));
  const [first, second] = days;
  if (!first) return null;
  switch (operator) {
    case "eq": return { sql: "v.metric_date = ?", params: [first] };
    case "ne": return { sql: "v.metric_date <> ?", params: [first] };
    case "gte": return { sql: "v.metric_date >= ?", params: [first] };
    case "gt": return { sql: "v.metric_date > ?", params: [first] };
    case "lte": return { sql: "v.metric_date <= ?", params: [first] };
    case "lt": return { sql: "v.metric_date < ?", params: [first] };
    case "between": return second ? { sql: "v.metric_date BETWEEN ? AND ?", params: [first, second] } : null;
    default: return null;
  }
}

/** Lọc cờ (bit): `eq`/`in` = có BẤT KỲ cờ nào trong danh sách (0 = sạch cờ); `ne`/`not_in` = ngược lại. */
export function buildMetricFlagsCondition(operator: Operator, values: string[]): SqlPart | null {
  const bits = values.map(Number);
  if (bits.length === 0 || bits.some((bit) => !Number.isInteger(bit) || bit < 0 || bit > ALL_FLAGS)) return null;
  const mask = bits.reduce((acc, bit) => acc | bit, 0);
  const clean = bits.includes(0);
  const hit = mask === 0 ? "v.flags = 0" : clean ? `(v.flags = 0 OR (v.flags & ${mask}) <> 0)` : `(v.flags & ${mask}) <> 0`;
  if (operator === "eq" || operator === "in") return { sql: hit, params: [] };
  if (operator === "ne" || operator === "not_in") return { sql: `NOT ${hit}`, params: [] };
  return null;
}

export const METRIC_VALUE_LIST_SPEC: ListSpec = {
  fields: {
    metric_date: { type: "date", build: buildMetricDateCondition },
    metric_code: { sql: "v.metric_code", type: "text" },
    area_key: { sql: "v.area_key", type: "text" },
    catalog_entry_id: { sql: "v.catalog_entry_id", type: "number" },
    source_id: { sql: "v.source_id", type: "number" },
    flags: { type: "number", build: buildMetricFlagsCondition },
  },
  sorts: { metric_date: "v.metric_date", value: "v.value", staff_name: "v.staff_name", area_name: "v.area_name", metric_code: "v.metric_code" },
  defaultSort: { by: "metric_date", dir: "desc" },
  tieBreaker: "v.id",
  search: { param: "q", columns: ["v.staff_name", "v.area_name", "v.raw_text"] },
};

const VALUE_COLUMNS = `v.id, DATE_FORMAT(v.metric_date, '%Y-%m-%d') AS metric_date, v.source_id, s.name AS source_name, v.staff_name,
  v.catalog_entry_id, v.area_key, v.area_name, v.metric_code, v.value, v.raw_text, v.flags, v.sheet_row`;
const VALUE_FROM = "FROM metric_value v JOIN metric_source s ON s.id = v.source_id";

const refToApi = (ref: ReporterRef, managers: Map<number, string>) => ({ id: ref.id, code: ref.code, name: ref.name, region: ref.region, manager: managers.get(ref.id) ?? "" });

export const metricRoutes: ApiRoute[] = [
  ["GET", /^\/api\/metrics\/catalog$/, async ({ response, service }) => {
    const [catalog, options] = await Promise.all([listMetricCatalog(service.db), listFilterOptions(service.db)]);
    sendOk(response, {
      metrics: catalog.map((item) => ({
        code: item.code, label: item.label, unit: item.unit, aggregate: item.aggregate, source_id: item.sourceId, source_name: item.sourceName, last_ok_at: item.lastOkAt,
      })),
      ...options,
    });
  }],

  ["GET", /^\/api\/metrics\/summary$/, async ({ response, url, service }) =>
    sendOk(response, await buildSummary(service.db, parseSummaryParams(url.searchParams)))],

  ["GET", /^\/api\/metrics\/values$/, async ({ response, url, service, principal }) => {
    const labels = new Map((await listMetricCatalog(service.db)).map((item) => [item.code, item]));
    sendOk(response, await runList(service.db, url.searchParams, METRIC_VALUE_LIST_SPEC, {
      select: VALUE_COLUMNS, from: VALUE_FROM, baseWhere: { sql: "s.tenant_id = ? AND s.is_active = 1", params: [principal.tenantId] },
      decorate: (rows) => rows.map((row) => ({
        ...row, value: row.value === null ? null : Number(row.value), flags: Number(row.flags), catalog_entry_id: row.catalog_entry_id === null ? null : Number(row.catalog_entry_id),
        metric_label: labels.get(String(row.metric_code))?.label ?? String(row.metric_code), unit: labels.get(String(row.metric_code))?.unit ?? "",
      })),
    }));
  }],

  ["GET", /^\/api\/metrics\/missing$/, async ({ response, url, service }) => {
    const date = url.searchParams.get("date") ? parseIsoDay(url.searchParams.get("date"), "Ngày") : vnLocalTime(new Date()).date;
    const result = await listMissingReporters(service.db, date, new Date());
    const managers = await loadManagerNames(service.db, [...result.missing, ...result.late].map((ref) => ref.id));
    sendOk(response, {
      date, ready: result.ready,
      missing: result.missing.map((ref) => refToApi(ref, managers)), late: result.late.map((ref) => refToApi(ref, managers)),
    });
  }],
];
