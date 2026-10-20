// mcp-guard: legacy(metrics) — query_metrics gọi metric-query-service; phase 11
import type { RowDataPacket } from "mysql2";
import { foldText } from "../alerts/keyword-matcher.js";
import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { Db } from "../db/pool.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import { aggregateMetrics, comparisonPeriod, listMetricCatalog, resolveMetricCodes, type ComparisonUnit, type MetricGroupBy } from "./metric-query-service.js";
import { listMissingReporters } from "./metric-missing-reporters.js";
import { loadStaffIndex } from "./metric-staff-resolver.js";

// Công cụ AI `query_metrics` (phase 10 — N3, phase 3 nối): trả SỐ đã đọc từ bảng Drive (bảng metric_value) kèm kỳ trước, % đổi,
// cờ và nguồn + giờ đọc. Chỉ tin riêng (không có trong nhóm). Không có dữ liệu thì nói rõ — không bịa số.

const PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "custom"];

export const QUERY_METRICS_DECLARATION: FunctionDeclaration = {
  name: "query_metrics",
  description:
    "SỐ LIỆU kinh doanh đọc từ bảng Google Sheets của công ty (doanh số, tồn kho… theo ngày / tuần / tháng, khu vực, nhân viên). " +
    "Trả tổng kỳ này, kỳ trước, % đổi, các dòng nhóm, số dòng có cờ, nguồn + giờ đọc. KHÔNG lấy số từ tin nhắn chat. Mỗi lần hỏi MỘT chỉ tiêu.",
  parameters: {
    type: "object",
    properties: {
      metric: { type: "string", description: "Tên chỉ tiêu, vd «doanh số», «tồn kho» (bỏ trống để xem danh sách chỉ tiêu đang có)" },
      period: { type: "string", enum: PERIODS, description: "Kỳ: today, yesterday, this_week (T2 → hôm nay), last_week, this_month (ngày 1 → hôm nay), last_month, custom (kèm from / to)" },
      from: { type: "string", description: "Ngày bắt đầu «YYYY-MM-DD» (khi period = custom)" },
      to: { type: "string", description: "Ngày kết thúc «YYYY-MM-DD» (khi period = custom)" },
      area: { type: "string", description: "Khu vực, vd «Miền Tây» (tùy chọn)" },
      staff: { type: "string", description: "Tên nhân viên (tùy chọn)" },
      group_by: { type: "string", enum: ["none", "staff", "area", "date"], description: "Chia dòng theo nhân viên / khu vực / ngày (mặc định none = chỉ tổng)" },
    },
    required: ["metric"],
  },
};

export const QUERY_METRICS_PROMPT = `SỐ LIỆU (query_metrics): hỏi doanh số / tồn kho / chỉ tiêu theo ngày, tuần, tháng, khu vực, nhân viên → gọi query_metrics.
- KHÔNG lấy số từ tin nhắn chat; đọc ĐÚNG số công cụ trả, ghi nguồn + giờ đọc (trường source).
- Dòng có cờ (flagged) hoặc công cụ có ghi chú cần xác nhận thì nói «cần xác nhận». Công cụ báo chưa có số liệu thì nói đúng như vậy, không đoán.`;

const DAY_MS = 86_400_000;
const MAX_ROWS = 30;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export interface QueryPeriod {
  from: string;
  to: string;
  label: string;
  /** Đơn vị kỳ để chọn kỳ so sánh (tuần / tháng); vắng = ngày lẻ / tùy chọn (cùng độ dài liền trước). */
  unit?: ComparisonUnit;
}

/**
 * Kỳ → khoảng ngày theo giờ VN (tuần T2–CN). «Tuần này / tháng này» CHƯA TRỌN nên chỉ tính tới hôm nay — kỳ so là cùng số ngày của
 * tuần / tháng trước (`comparisonPeriod`). `error` khi tham số sai.
 */
export function resolveQueryPeriod(args: Record<string, unknown>, now: Date): QueryPeriod | { error: string } {
  const today = vnLocalTime(now);
  const todayMs = dayMs(today.date);
  const period = typeof args.period === "string" && args.period ? args.period : "today";
  const vn = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const range = (fromMs: number, toMs: number, name: string, unit?: ComparisonUnit): QueryPeriod => ({
    from: isoOf(fromMs), to: isoOf(toMs), label: `${name} (${vn(isoOf(fromMs))} – ${vn(isoOf(toMs))})`, ...(unit ? { unit } : {}),
  });
  const weekStart = todayMs - (today.weekday - 1) * DAY_MS;
  const monthStartOf = (offset: number) => { const d = new Date(todayMs); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1); };
  switch (period) {
    case "today": return range(todayMs, todayMs, "hôm nay");
    case "yesterday": return range(todayMs - DAY_MS, todayMs - DAY_MS, "hôm qua");
    case "this_week": return range(weekStart, todayMs, "tuần này", "week");
    case "last_week": return range(weekStart - 7 * DAY_MS, weekStart - DAY_MS, "tuần trước", "week");
    case "this_month": return range(monthStartOf(0), todayMs, "tháng này", "month");
    case "last_month": return range(monthStartOf(-1), monthStartOf(0) - DAY_MS, "tháng trước", "month");
    case "custom": {
      const from = typeof args.from === "string" ? args.from.trim() : "";
      const to = typeof args.to === "string" && args.to.trim() ? args.to.trim() : from;
      if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || Number.isNaN(dayMs(from)) || Number.isNaN(dayMs(to))) return { error: "Kỳ tùy chọn cần from / to dạng YYYY-MM-DD." };
      if (dayMs(to) < dayMs(from)) return { error: "Ngày kết thúc đứng trước ngày bắt đầu." };
      if (dayMs(to) - dayMs(from) > 366 * DAY_MS) return { error: "Kỳ tối đa 366 ngày." };
      return range(dayMs(from), dayMs(to), "kỳ chọn");
    }
    default: return { error: `period không hợp lệ (${period}); dùng: ${PERIODS.join(", ")}.` };
  }
}

const GROUPS: Record<string, MetricGroupBy> = { staff: "staff", area: "area", date: "date" };
const readTime = (at: Date | null) => {
  if (!at) return "chưa rõ";
  const local = new Date(at.getTime() + 7 * 3_600_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};

/** Khu vực người hỏi gõ → khóa khu vực trong số liệu (khớp gấp dấu, chấp nhận chứa). */
async function findAreaKey(db: Db, text: string): Promise<{ key: string } | { error: string }> {
  const folded = foldText(text).trim();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT v.area_key, v.area_name FROM metric_value v JOIN metric_source s ON s.id = v.source_id
     WHERE s.is_active = 1 AND v.area_key <> '' ORDER BY v.area_name LIMIT 200`);
  const hits = rows.filter((row) => String(row.area_key) === folded || String(row.area_key).includes(folded));
  const exact = hits.find((row) => String(row.area_key) === folded);
  if (exact) return { key: String(exact.area_key) };
  if (hits.length === 1) return { key: String(hits[0].area_key) };
  const names = (hits.length ? hits : rows).slice(0, 15).map((row) => String(row.area_name));
  return { error: `${hits.length ? "Khu vực chưa rõ" : "Không có khu vực"} «${text}» trong số liệu. Khu vực đang có: ${names.join(", ") || "(chưa có)"}.` };
}

async function findStaffId(db: Db, text: string): Promise<{ id: number } | { error: string }> {
  const folded = foldText(text).trim();
  const index = await loadStaffIndex(db);
  const hits = [...index.byCode.values()].filter((entry) => foldText(entry.name).includes(folded) || foldText(entry.code) === folded);
  if (hits.length === 1) return { id: hits[0].id };
  return { error: hits.length ? `Có ${hits.length} nhân viên khớp «${text}»: ${hits.slice(0, 8).map((e) => e.name).join(", ")} — hỏi lại tên đầy đủ.` : `Không thấy nhân viên «${text}» trong danh mục.` };
}

export async function runQueryMetricsTool(context: { db: Db; now: Date }, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { db, now } = context;
  const catalog = await listMetricCatalog(db);
  if (catalog.length === 0) return { error: "Chưa có số liệu từ bảng Drive (đang chờ IDA gửi link bảng)." };
  const available = [...new Set(catalog.map((item) => item.label))];
  const metricText = typeof args.metric === "string" ? args.metric.trim() : "";
  const codes = metricText ? resolveMetricCodes(catalog, metricText) : [];
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
