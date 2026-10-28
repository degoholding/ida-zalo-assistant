import type { RowDataPacket } from "mysql2";
import { McpCallSource, McpCallStatus } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { ApiError, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";

// Thống kê tải + chi phí cổng MCP (phase 13.6, 28/10/2026) từ mcp_call_log: theo ngày (giờ VN) × khóa hoặc × người — số lượt, lỗi, bị chặn,
// quá nhịp, thời gian trung bình / p95, số dòng + ký tự trả ra (ước lượng token = ký tự / 4), công cụ dùng nhiều nhất. CHỈ QUẢN TRỊ: đường
// /api/mcp-usage cố ý KHÔNG khai ở route-permissions.ts nên rơi vào luật mặc định (cần setting.write).

export const USAGE_DEFAULT_DAYS = 7;
export const USAGE_MAX_DAYS = 90;
const MAX_ROWS = 500;
const TOP_TOOLS = 15;
const TO_VN_DAY = "DATE_FORMAT(CONVERT_TZ(l.created_at, '+00:00', '+07:00'), '%Y-%m-%d')";

export interface UsageParams {
  days: number;
  groupBy: "key" | "user";
  sources: McpCallSource[];
}

/** Tham số URL → đã kiểm. `days` 1–90 (mặc định 7), `group` key / user, `source` http (mặc định, cổng ngoài) / all. */
export function parseUsageParams(params: URLSearchParams): UsageParams {
  const rawDays = params.get("days");
  const days = rawDays === null || rawDays === "" ? USAGE_DEFAULT_DAYS : Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > USAGE_MAX_DAYS) throw new ApiError(422, "validation_error", `Số ngày phải từ 1 đến ${USAGE_MAX_DAYS}`);
  const group = params.get("group") ?? "key";
  if (group !== "key" && group !== "user") throw new ApiError(422, "validation_error", "Gộp theo chỉ nhận key hoặc user");
  const source = params.get("source") ?? "http";
  if (source !== "http" && source !== "all") throw new ApiError(422, "validation_error", "Nguồn chỉ nhận http hoặc all");
  const sources = source === "all" ? [McpCallSource.Http, McpCallSource.Assistant, McpCallSource.AssistantCommand] : [McpCallSource.Http];
  return { days, groupBy: group, sources };
}

/** Mốc bắt đầu: 00:00 giờ VN của (hôm nay − days + 1), đổi về UTC. Hàm thuần. */
export function usageStart(now: Date, days: number): Date {
  const vnMidnight = Math.floor((now.getTime() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000;
  return new Date(vnMidnight - (days - 1) * 86_400_000);
}

const STATUS_SUMS = `SUM(status = ${McpCallStatus.Ok}) AS ok, SUM(status = ${McpCallStatus.Error}) AS errors,
  SUM(status IN (${McpCallStatus.Denied}, ${McpCallStatus.Invalid})) AS rejected, SUM(status = ${McpCallStatus.RateLimited}) AS rate_limited`;

const num = (value: unknown): number => Number(value ?? 0) || 0;

function shapeCounts(row: RowDataPacket) {
  const chars = num(row.chars);
  return {
    calls: num(row.calls), ok: num(row.ok), errors: num(row.errors), rejected: num(row.rejected), rate_limited: num(row.rate_limited),
    avg_ms: Math.round(num(row.avg_ms)), p95_ms: Math.round(num(row.p95_ms)), rows: num(row.rows_out), chars, est_tokens: Math.round(chars / 4),
  };
}

export async function loadMcpUsage(db: Db, tenantId: number, params: UsageParams, now = new Date()) {
  const since = usageStart(now, params.days);
  const subject = params.groupBy === "key" ? "key_id" : "user_id";
  const where = "l.tenant_id = ? AND l.created_at >= ? AND l.source IN (?)";
  const whereParams = [tenantId, since, params.sources];
  // p95 theo cửa sổ (MySQL 8): xếp thời gian trong từng (ngày, đối tượng), lấy dòng thứ CEIL(0,95 × số lượt)
  const [daily] = await db.query<RowDataPacket[]>(
    `WITH base AS (
       SELECT ${TO_VN_DAY} AS usage_day, l.${subject} AS subject_id, l.status, l.duration_ms, l.row_count, l.result_chars
       FROM mcp_call_log l WHERE ${where}
     ), ranked AS (
       SELECT base.*, ROW_NUMBER() OVER (PARTITION BY usage_day, subject_id ORDER BY duration_ms) AS rn,
              COUNT(*) OVER (PARTITION BY usage_day, subject_id) AS cnt
       FROM base
     )
     SELECT usage_day, subject_id, COUNT(*) AS calls, ${STATUS_SUMS}, AVG(duration_ms) AS avg_ms,
            MAX(CASE WHEN rn = CEIL(0.95 * cnt) THEN duration_ms END) AS p95_ms, SUM(row_count) AS rows_out, SUM(result_chars) AS chars
     FROM ranked GROUP BY usage_day, subject_id ORDER BY usage_day DESC, calls DESC LIMIT ${MAX_ROWS + 1}`, whereParams);
  const [tools] = await db.query<RowDataPacket[]>(
    `SELECT l.tool, COUNT(*) AS calls, ${STATUS_SUMS}, AVG(l.duration_ms) AS avg_ms, SUM(l.row_count) AS rows_out, SUM(l.result_chars) AS chars
     FROM mcp_call_log l WHERE ${where} GROUP BY l.tool ORDER BY calls DESC, l.tool LIMIT ${TOP_TOOLS}`, whereParams);
  const [totalRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS calls, ${STATUS_SUMS}, AVG(l.duration_ms) AS avg_ms, SUM(l.row_count) AS rows_out, SUM(l.result_chars) AS chars
     FROM mcp_call_log l WHERE ${where}`, whereParams);
  const total = totalRows[0] ?? {};
  let p95 = 0;
  const calls = num(total.calls);
  if (calls > 0) {
    const [p95Rows] = await db.query<RowDataPacket[]>(
      `SELECT l.duration_ms FROM mcp_call_log l WHERE ${where} ORDER BY l.duration_ms LIMIT 1 OFFSET ${Math.ceil(0.95 * calls) - 1}`, whereParams);
    p95 = num(p95Rows[0]?.duration_ms);
  }
  const ids = [...new Set(daily.map((row) => row.subject_id).filter((id) => id !== null && id !== undefined).map(Number))];
  const names = await subjectNames(db, params.groupBy, ids);
  return {
    since: since.toISOString(), days: params.days, group_by: params.groupBy,
    totals: { ...shapeCounts({ ...total, p95_ms: p95 } as RowDataPacket) },
    daily: daily.slice(0, MAX_ROWS).map((row) => {
      const id = row.subject_id === null || row.subject_id === undefined ? null : Number(row.subject_id);
      const info = id === null ? undefined : names.get(id);
      return { day: String(row.usage_day), subject_id: id, subject_name: info?.name ?? (id === null ? "Trợ lý (không khóa)" : `#${id}`), owner_name: info?.owner ?? "", ...shapeCounts(row) };
    }),
    truncated: daily.length > MAX_ROWS,
    top_tools: tools.map((row) => ({ tool: String(row.tool), ...shapeCounts(row) })),
  };
}

async function subjectNames(db: Db, groupBy: UsageParams["groupBy"], ids: number[]): Promise<Map<number, { name: string; owner: string }>> {
  if (!ids.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(groupBy === "key"
    ? `SELECT k.id, CONCAT(k.name, ' (', k.prefix, ')') AS name, COALESCE(NULLIF(u.full_name, ''), u.username, u.email) AS owner
       FROM mcp_api_key k LEFT JOIN app_user u ON u.id = k.user_id WHERE k.id IN (?)`
    : "SELECT u.id, COALESCE(NULLIF(u.full_name, ''), u.username, u.email) AS name, '' AS owner FROM app_user u WHERE u.id IN (?)", [ids]);
  return new Map(rows.map((row) => [Number(row.id), { name: String(row.name ?? ""), owner: String(row.owner ?? "") }]));
}

export const mcpUsageRoutes: ApiRoute[] = [
  ["GET", /^\/api\/mcp-usage$/, async ({ response, url, service, principal }) => {
    sendOk(response, await loadMcpUsage(service.db, principal.tenantId, parseUsageParams(url.searchParams)));
  }],
];
