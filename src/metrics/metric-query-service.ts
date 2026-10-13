import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { validateMapping } from "./metric-mapping.js";
import {
  rollupFacts, type MetricAggregateResult, type MetricCatalogItem, type MetricFact, type MetricGroupBy,
} from "./metric-aggregation.js";
import { comparisonPeriod, type DayRange } from "./metric-comparison-period.js";
import { listActiveSources } from "./metric-source-repository.js";
import type { MetricAggregate } from "./metric-types.js";

// Truy vấn số liệu DÙNG CHUNG: màn web «Số liệu» (phase 8), công cụ AI `query_metrics` (phase 3), bản tin / báo cáo (phase 5).
// Chỉ đọc nguồn ĐANG BẬT. Phần thuần (khớp tên, gom nhóm) ở metric-aggregation.ts.

export { resolveMetricCodes, type MetricAggregateResult, type MetricCatalogItem, type MetricGroupBy } from "./metric-aggregation.js";
export { comparisonPeriod, previousPeriod, type ComparisonUnit, type DayRange } from "./metric-comparison-period.js";

/** Chỉ tiêu của các nguồn đang bật (từ ánh xạ) + giờ đọc thành công gần nhất. Nguồn ánh xạ hỏng thì bỏ qua. */
export async function listMetricCatalog(db: Db): Promise<MetricCatalogItem[]> {
  const items: MetricCatalogItem[] = [];
  for (const source of await listActiveSources(db)) {
    const mapping = validateMapping(source.mapping);
    if (!mapping.ok) continue;
    for (const def of mapping.mapping.metrics) {
      items.push({ code: def.code, label: def.label, unit: def.unit, aggregate: def.aggregate, sourceId: source.id, sourceName: source.name, lastOkAt: source.lastOkAt });
    }
  }
  return items;
}

export interface MetricQuery {
  codes: string[];
  /** Ngày «YYYY-MM-DD», gồm cả hai đầu */
  from: string;
  to: string;
  areaKey?: string;
  catalogEntryId?: number;
  groupBy: MetricGroupBy;
  /** Kỳ so sánh tính sẵn; `null` = không so (không nạp kỳ trước). Bỏ trống = `comparisonPeriod(from, to, { today })`. */
  compare?: DayRange | null;
  /** Hôm nay (giờ VN) — kỳ chưa trọn so cùng số ngày của kỳ trước (xem metric-comparison-period.ts). */
  today?: string;
}

async function loadFacts(db: Db, query: MetricQuery, from: string, to: string): Promise<MetricFact[]> {
  if (query.codes.length === 0) return [];
  const where = ["s.is_active = 1", "v.metric_date BETWEEN ? AND ?", `v.metric_code IN (${query.codes.map(() => "?").join(",")})`];
  const params: unknown[] = [from, to, ...query.codes];
  if (query.areaKey !== undefined) { where.push("v.area_key = ?"); params.push(query.areaKey); }
  if (query.catalogEntryId !== undefined) { where.push("v.catalog_entry_id = ?"); params.push(query.catalogEntryId); }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(v.metric_date, '%Y-%m-%d') AS d, v.staff_key, v.staff_name, v.area_key, v.area_name, v.metric_code, v.value, v.flags
     FROM metric_value v JOIN metric_source s ON s.id = v.source_id WHERE ${where.join(" AND ")}`,
    params,
  );
  return rows.map((row) => ({
    date: String(row.d), staffKey: String(row.staff_key), staffName: String(row.staff_name), areaKey: String(row.area_key),
    areaName: String(row.area_name), code: String(row.metric_code), value: row.value === null ? null : Number(row.value), flags: Number(row.flags),
  }));
}

export async function aggregateMetrics(db: Db, query: MetricQuery): Promise<MetricAggregateResult> {
  const catalog = await listMetricCatalog(db);
  const aggregates = new Map<string, MetricAggregate>(catalog.map((item) => [item.code, item.aggregate]));
  const labels = new Map(catalog.map((item) => [item.code, item.label]));
  const previous = query.compare === undefined ? comparisonPeriod(query.from, query.to, { today: query.today }) : query.compare;
  const [current, before] = await Promise.all([
    loadFacts(db, query, query.from, query.to),
    query.groupBy === "date" || previous === null ? Promise.resolve([]) : loadFacts(db, query, previous.from, previous.to),
  ]);
  return rollupFacts(current, before, aggregates, query.groupBy, labels);
}
