import type { Db } from "../../db/pool.js";
import { vnLocalTime } from "../../schedule/work-calendar.js";
import { listMissingReporters } from "../../metrics/metric-missing-reporters.js";
import { aggregateMetrics, comparisonPeriod, listMetricCatalog, type MetricGroupBy } from "../../metrics/metric-query-service.js";
import { findAreaKey, findStaffId, resolveMetricName } from "../resolvers/metric-name-resolver.js";
import { resolveQueryPeriod } from "../resolvers/metric-period-resolver.js";

// Hàm lõi hỏi số liệu theo TÊN chỉ tiêu + KỲ chữ: một nơi phân giải (chỉ tiêu, kỳ + kỳ so sánh, khu vực / nhân viên theo tên), gọi dịch vụ
// số liệu, thêm người chưa báo + nguồn + giờ đọc. Hai vỏ dùng chung: `query_metrics` (mặt mô hình) và đường cũ của trợ lý (`metric-query-tool`).
// Quyền (`metric.read`) kiểm ở vỏ — hàm này chỉ đọc. Lỗi nghiệp vụ trả `{ error }` (câu cho người hỏi), như công cụ cũ.

const MAX_ROWS = 30;
const GROUPS: Record<string, MetricGroupBy> = { staff: "staff", area: "area", date: "date" };
const readTime = (at: Date | null) => {
  if (!at) return "chưa rõ";
  const local = new Date(at.getTime() + 7 * 3_600_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};

export async function runQueryMetrics(context: { db: Db; now: Date }, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { db, now } = context;
  const catalog = await listMetricCatalog(db);
  if (catalog.length === 0) return { error: "Chưa có số liệu từ bảng Drive (đang chờ IDA gửi link bảng)." };
  const metricText = typeof args.metric === "string" ? args.metric.trim() : "";
  const { codes, available } = resolveMetricName(catalog, metricText);
  if (codes.length === 0) return { error: `Không khớp chỉ tiêu «${metricText}».`, available_metrics: available };
  const groupArg = typeof args.group_by === "string" ? args.group_by : "none";
  const groupBy: MetricGroupBy = GROUPS[groupArg] ?? "metric";
  if (codes.length > 1 && groupBy !== "metric") return { error: "Câu hỏi khớp nhiều chỉ tiêu — hỏi lại từng chỉ tiêu một khi cần chia theo nhân viên / khu vực / ngày.", matched: codes };

  const period = resolveQueryPeriod(args, now);
  if ("error" in period) return period;
  const prev = comparisonPeriod(period.from, period.to, { unit: period.unit, today: vnLocalTime(now).date });
  const query = { codes, from: period.from, to: period.to, groupBy, compare: prev } as Parameters<typeof aggregateMetrics>[1];
  if (typeof args.area === "string" && args.area.trim()) {
    const area = await findAreaKey(db, args.area);
    if ("error" in area) return area;
    query.areaKey = area.key;
  }
  if (typeof args.staff === "string" && args.staff.trim()) {
    const staff = await findStaffId(db, args.staff);
    if ("error" in staff) return staff;
    query.catalogEntryId = staff.id;
  }

  const items = catalog.filter((item) => codes.includes(item.code));
  const source = [...new Map(items.map((item) => [item.sourceId, item])).values()]
    .map((item) => `${item.sourceName}, đọc lúc ${readTime(item.lastOkAt)}`).join("; ");
  const result = await aggregateMetrics(db, query);
  if (result.rows.length === 0) {
    return { error: `Chưa có số liệu «${items[0].label}» trong ${period.label} (nguồn: ${source}).`, source };
  }
  const single = codes.length === 1;
  const response: Record<string, unknown> = {
    metrics: items.map((item) => ({ code: item.code, name: item.label, unit: item.unit })),
    period: period.label,
    previous_period: `${prev.from} – ${prev.to}`,
    group_by: groupBy === "metric" ? "none" : groupArg,
    rows: result.rows.slice(0, MAX_ROWS).map((row) => ({ name: row.label, value: row.value, previous: row.previous, change_pct: row.changePct, flagged: row.flagged })),
    truncated: result.rows.length > MAX_ROWS,
    flagged_rows: result.rows.filter((row) => row.flagged).length,
    source: `nguồn: ${source}`,
  };
  if (single && groupBy !== "date") {
    response.total = result.total;
    response.previous_total = result.previousTotal;
    response.change_pct = result.previousTotal ? Math.round(((result.total - result.previousTotal) / Math.abs(result.previousTotal)) * 1000) / 10 : null;
  } else if (single) {
    response.total = result.total;
  }
  if (period.from === period.to) {
    const missing = await listMissingReporters(db, period.from, now);
    if (missing.ready) response.not_reported_staff = missing.missing.length;
  }
  return response;
}
