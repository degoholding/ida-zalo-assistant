import { vnLocalTime } from "../schedule/work-calendar.js";
import type { BriefPeriod } from "../briefs/brief-types.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { aggregateMetrics, comparisonPeriod, listMetricCatalog, type DayRange, type MetricGroupBy } from "../metrics/metric-query-service.js";
import type { MetricAggregateRow } from "../metrics/metric-aggregation.js";
import type { MetricBreakdownRow, MetricFigure, PeriodicMetricSummary } from "./periodic-report-types.js";

// Gom số liệu (bảng Drive) cho báo cáo tuần / tháng — gọi `aggregateMetrics` (phase 4) cho cả kỳ. Số không theo phạm vi
// nhóm (không gắn nhóm Zalo) nên mọi người nhận thấy cùng số. Không có nguồn / không có số → `undefined` (ẩn hẳn).

const log = createLogger("periodic-report-metrics");
/** Tối đa bấy nhiêu chỉ tiêu: Excel 1 + 3 cột / chỉ tiêu ≤ 20 cột, PDF / tóm tắt chỉ lấy 4 chỉ tiêu đầu. */
export const MAX_REPORT_METRICS = 6;

/** Ngày «YYYY-MM-DD» (giờ VN) đầu và cuối của kỳ; `to` của kỳ là nửa khoảng mở nên lùi 1 ms. */
export function periodDays(period: Pick<BriefPeriod, "from" | "to">): { from: string; to: string } {
  const from = vnLocalTime(period.from).date;
  const last = vnLocalTime(new Date(Math.max(period.to.getTime() - 1, period.from.getTime()))).date;
  return { from, to: last };
}

type Figure = MetricBreakdownRow["figures"][string];
const figureOf = (row: MetricAggregateRow): Figure => ({ current: row.value, previous: row.previous, changePct: row.changePct });

/** Gộp kết quả `aggregateMetrics` theo từng chỉ tiêu thành các dòng (NV hoặc khu vực) × chỉ tiêu. */
async function breakdown(db: Db, codes: string[], range: { from: string; to: string; compare: DayRange }, groupBy: MetricGroupBy): Promise<MetricBreakdownRow[]> {
  const rows = new Map<string, MetricBreakdownRow>();
  for (const code of codes) {
    const result = await aggregateMetrics(db, { codes: [code], ...range, groupBy });
    for (const row of result.rows) {
      const entry = rows.get(row.key) ?? { name: row.label, flagged: false, figures: {} };
      entry.figures[code] = figureOf(row);
      entry.flagged ||= row.flagged;
      rows.set(row.key, entry);
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/**
 * Lỗi truy vấn → ghi cảnh báo, trả `undefined` (báo cáo vẫn ra, chỉ không có số liệu). `unit` = tuần / tháng: kỳ trọn so kỳ trọn trước
 * (tháng 9 so cả tháng 8); «kỳ này» chưa trọn (T2 → hôm nay, ngày 1 → hôm nay) so cùng số ngày của kỳ trước.
 */
export async function collectPeriodicMetrics(
  db: Db, period: Pick<BriefPeriod, "from" | "to">, unit: "week" | "month",
): Promise<PeriodicMetricSummary | undefined> {
  try {
    const catalog = await listMetricCatalog(db);
    const codes = [...new Set(catalog.map((item) => item.code))];
    if (codes.length === 0) return undefined;
    const days = periodDays(period);
    const range = { ...days, compare: comparisonPeriod(days.from, days.to, { unit }) };
    const totals = await aggregateMetrics(db, { codes, ...range, groupBy: "metric" });
    const rowOf = new Map(totals.rows.map((row) => [row.key, row]));
    const metrics: MetricFigure[] = [];
    for (const code of codes) {
      const row = rowOf.get(code);
      const item = catalog.find((entry) => entry.code === code);
      if (row && item && metrics.length < MAX_REPORT_METRICS) {
        metrics.push({ code, label: item.label, unit: item.unit, current: row.value, previous: row.previous, changePct: row.changePct });
      }
    }
    if (metrics.length === 0) return undefined;
    const used = metrics.map((metric) => metric.code);
    const [staff, areas] = await Promise.all([breakdown(db, used, range, "staff"), breakdown(db, used, range, "area")]);
    return { metrics, staff, areas, flaggedCount: staff.filter((row) => row.flagged).length };
  } catch (error) {
    log.warn(`bỏ số liệu khỏi báo cáo: ${describeError(error)}`);
    return undefined;
  }
}
