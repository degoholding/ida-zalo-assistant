import { z } from "zod/v4";
import { ApiError } from "../../web/api/api-http.js";
import { buildSummary, parseSummaryParams } from "../../web/api/metric-summary-query.js";
import type { RowDataPacket } from "mysql2";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { listMetricCatalog } from "../../metrics/metric-query-service.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { resolveMetricName } from "../resolvers/metric-name-resolver.js";
import { METRIC_PERIODS, resolveQueryPeriod } from "../resolvers/metric-period-resolver.js";
import { dbDateToVnIso } from "../vn-time.js";
import type { ToolDefinition } from "../tool-definition.js";

// metrics_summary: tổng hợp số liệu kinh doanh theo nhân viên / khu vực / ngày, kèm % đổi so kỳ trước và số dòng có cờ — cùng hàm
// với màn web «Số liệu» (buildSummary). Quyền metric.read (Quản trị + Quản lý).

const inputSchema = z.object({
  metrics: z.array(z.string().min(1).max(40)).min(1).max(20).optional().describe("Mã chỉ tiêu (cột metric_code của entity metrics). Bỏ trống thì dùng metric_name."),
  metric_name: z.string().max(80).optional().describe("Thay cho metrics: tên chỉ tiêu bằng chữ, vd «doanh số», «tồn kho» (khớp bỏ dấu). Không khớp → báo danh sách chỉ tiêu đang có."),
  period: z.enum(METRIC_PERIODS).optional().describe("Thay cho from / to: kỳ chữ theo giờ VN — today, yesterday, this_week (T2 → hôm nay), last_week, this_month (ngày 1 → hôm nay), last_month, custom (kèm from / to)."),
  from: z.string().optional().describe("Ngày bắt đầu 'YYYY-MM-DD' (bắt buộc nếu không có period; với period = custom là đầu kỳ)."),
  to: z.string().optional().describe("Ngày kết thúc 'YYYY-MM-DD' (tối đa 366 ngày từ ngày bắt đầu)."),
  group_by: z.enum(["staff", "area", "date"]).optional().describe("Gộp theo nhân viên (mặc định), khu vực hoặc ngày."),
  area: z.string().max(80).optional().describe("Chỉ khu vực này (area_key)."),
  staff_id: z.number().int().positive().optional().describe("Chỉ nhân viên này (catalog_entry_id)."),
});
type MetricsInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  total: z.record(z.string(), z.unknown()),
  previous_period: z.unknown(),
  single_metric: z.boolean(),
  unit: z.string(),
  sources: z.array(z.string()),
  last_ok_at: z.string().nullable(),
  notices: z.array(z.string()),
});
type MetricsOutput = z.infer<typeof outputSchema>;

/**
 * `buildSummary` (dùng chung với màn web) KHÔNG lọc theo tenant — nguồn số liệu của tenant khác sẽ lọt vào tổng. Hiện chỉ có một
 * tenant nên chưa sao; có nguồn thuộc tenant khác thì từ chối (thà lỗi còn hơn lẫn số liệu) tới khi `buildSummary` hỗ trợ tenant.
 */
async function assertSingleTenantMetrics(ctx: DataAccessContext): Promise<void> {
  let foreign: boolean;
  try {
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT ${QUERY_TIME_HINT} 1 FROM metric_source s WHERE s.is_active = 1 AND s.tenant_id <> ? LIMIT 1`, [ctx.principal.tenantId]);
    foreign = Boolean(rows[0]);
  } catch (error) {
    return translateDbError(error);
  }
  if (foreign) throw new DataAccessError("forbidden", "Số liệu nhiều tenant chưa được hỗ trợ cho metrics_summary — dùng query_records entity metrics.");
}

/** Mã chỉ tiêu + khoảng ngày cuối cùng: từ `metrics` / `from` / `to` tường minh (như cũ) hoặc phân giải từ `metric_name` / `period` (thêm sau). */
async function resolveSummaryInput(ctx: DataAccessContext, input: MetricsInput): Promise<{ codes: string[]; from: string; to: string }> {
  let codes = input.metrics ?? [];
  if (codes.length === 0) {
    const name = input.metric_name?.trim() ?? "";
    if (!name) throw new DataAccessError("invalid_value", "Cần metrics (mã chỉ tiêu) hoặc metric_name (tên chỉ tiêu).");
    let match;
    try {
      match = resolveMetricName(await listMetricCatalog(ctx.db), name);
    } catch (error) {
      return translateDbError(error);
    }
    if (match.codes.length === 0) throw new DataAccessError("invalid_value", `Không khớp chỉ tiêu «${name}». Chỉ tiêu đang có: ${match.available.join(", ") || "(chưa có)"}.`);
    codes = match.codes;
  }
  if (input.period) {
    const period = resolveQueryPeriod(input, ctx.now);
    if ("error" in period) throw new DataAccessError("invalid_value", period.error);
    return { codes, from: period.from, to: period.to };
  }
  if (!input.from || !input.to) throw new DataAccessError("invalid_value", "Cần from và to (YYYY-MM-DD) hoặc period.");
  return { codes, from: input.from, to: input.to };
}

export const metricsSummaryTool: ToolDefinition<MetricsInput, MetricsOutput> = {
  name: "metrics_summary",
  title: "Tổng hợp số liệu",
  description: "Tổng hợp số liệu kinh doanh theo nhân viên / khu vực / ngày trong một khoảng, kèm % đổi so với kỳ trước. Chỉ tiêu: mã (metrics, lấy từ query_records entity metrics) hoặc tên chữ (metric_name); khoảng: from / to hoặc kỳ chữ (period).",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "metric", "read"),
  async handler(ctx, input) {
    const resolved = await resolveSummaryInput(ctx, input);
    const query = new URLSearchParams({ metric: resolved.codes.join(","), from: resolved.from, to: resolved.to });
    if (input.group_by) query.set("group_by", input.group_by);
    if (input.area) query.set("area", input.area);
    if (input.staff_id !== undefined) query.set("staff", String(input.staff_id));
    let params;
    try {
      params = parseSummaryParams(query);
    } catch (error) {
      if (error instanceof ApiError) throw new DataAccessError("invalid_value", error.message);
      throw error;
    }
    await assertSingleTenantMetrics(ctx);
    const summary = await buildSummary(ctx.db, params, ctx.now);
    const rows = (summary.rows as Record<string, unknown>[]) ?? [];
    const structured: MetricsOutput = {
      rows, total: summary.total as Record<string, unknown>, previous_period: summary.previous_period ?? null,
      single_metric: Boolean(summary.single_metric), unit: String(summary.unit ?? ""), sources: (summary.sources as string[]) ?? [],
      last_ok_at: dbDateToVnIso(summary.last_ok_at), notices: [],
    };
    return { structured, summary: `Số liệu ${resolved.codes.join(", ")} (${resolved.from} → ${resolved.to}): ${rows.length} dòng.`, rowCount: rows.length };
  },
};
