import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { escapeLikeText, type SqlPart } from "../../web/api/list-query.js";
import { threadOfAccountsCondition } from "../../web/api/conversation-accounts.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { translateDbError } from "../data-access-errors.js";
import { assertNoPersonalNumberProbe } from "../masked-filter-guard.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { dbDateToVnIso } from "../vn-time.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";
import { ACTIVITY_MAX_DAYS, resolveActivityPeriod } from "./activity-summary-operation.js";

// reply_metrics (phase 15, 10/11/2026): CHỈ SỐ PHẢN HỒI KHÁCH tính sẵn mỗi ngày (bảng reply_metric_daily, src/reply-metrics) cho sếp hỏi qua
// MCP — Claude lấy số rồi viết nhận xét, không phải kéo tin thô. Một «lượt chờ» = khách nhắn tới khi nhân viên đầu tiên trả lời;
// chờ đo bằng giờ thường và giờ LÀM VIỆC (lịch Cài đặt); trễ = quá ngưỡng «chờ trả lời» của cảnh báo (phút làm việc). Cùng luật thấy
// cuộc với messages (threadVisibilitySql). Dòng tổng của cuộc (responder = '') và dòng theo người trả lời là hai lớp khác nhau nên
// gộp theo cuộc / ngày đọc lớp tổng, gộp theo người đọc lớp người.

export const REPLY_GROUPINGS = ["thread_day", "thread", "day", "responder", "responder_day", "thread_responder"] as const;
export type ReplyGrouping = (typeof REPLY_GROUPINGS)[number];
export const REPLY_DEFAULT_ROWS = 200;
export const REPLY_MAX_ROWS = 1000;
const MAX_FILTER_VALUES = 200;
const THREAD_NAME = "MAX(COALESCE(NULLIF(g.label, ''), g.name))";

export const replyInputSchema = z.object({
  from: z.string().max(10).optional().describe("Từ ngày 'YYYY-MM-DD' (giờ VN). Bỏ trống = 7 ngày gần nhất tính tới hôm nay."),
  to: z.string().max(10).optional().describe(`Đến ngày 'YYYY-MM-DD', tính CẢ ngày này. Bỏ trống = hôm nay. Tối đa ${ACTIVITY_MAX_DAYS} ngày một lần.`),
  group_by: z.enum(REPLY_GROUPINGS).optional().describe(
    "thread_day = mỗi nhóm / cuộc × ngày (mặc định); thread = mỗi nhóm / cuộc cả kỳ; day = mỗi ngày cả kỳ; responder = mỗi nhân viên trả lời cả kỳ; " +
    "responder_day = nhân viên × ngày; thread_responder = nhóm × nhân viên. Các kiểu responder* chỉ có số lượt họ trả lời + thời gian chờ + tin họ gửi."),
  thread_ids: z.array(z.number().int().positive()).max(MAX_FILTER_VALUES).optional().describe("Chỉ các nhóm / cuộc này (id của groups / conversations)."),
  account_ids: z.array(z.number().int().positive()).max(MAX_FILTER_VALUES).optional().describe("Chỉ cuộc thuộc các tài khoản Zalo này của bot (id ở whoami)."),
  responder_uids: z.array(z.string().min(1).max(40)).max(MAX_FILTER_VALUES).optional().describe("Chỉ các nhân viên trả lời này (sender_uid) — áp cho kiểu responder*."),
  responder_name: z.string().min(2).max(80).optional().describe("Chỉ nhân viên trả lời có tên chứa chuỗi này — áp cho kiểu responder*."),
  max_rows: z.number().int().min(1).max(REPLY_MAX_ROWS).optional().describe(`Số dòng tối đa (mặc định ${REPLY_DEFAULT_ROWS}, tối đa ${REPLY_MAX_ROWS}).`),
});
export type ReplyInput = z.infer<typeof replyInputSchema>;

const countsSchema = z.object({
  customer_messages: z.number(),
  episodes: z.number(),
  answered: z.number(),
  answered_late: z.number(),
  open_episodes: z.number(),
  open_overdue: z.number(),
  /** Tỷ lệ lượt trả lời đúng hạn trong số đã trả lời (0–1); null khi chưa lượt nào. */
  on_time_rate: z.number().nullable(),
  avg_wait_minutes: z.number().nullable(),
  max_wait_minutes: z.number().nullable(),
  avg_work_wait_minutes: z.number().nullable(),
  max_work_wait_minutes: z.number().nullable(),
  staff_messages: z.number(),
  assistant_replies: z.number(),
});
const rowSchema = countsSchema.extend({
  thread_id: z.number().nullable(),
  thread_name: z.string().nullable(),
  responder_uid: z.string().nullable(),
  responder_name: z.string().nullable(),
  day: z.string().nullable(),
});
export type ReplyRow = z.infer<typeof rowSchema>;

const outputSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), days: z.number() }),
  group_by: z.enum(REPLY_GROUPINGS),
  sla_minutes: z.number().nullable(),
  computed_at: z.string().nullable(),
  rows: z.array(rowSchema),
  totals: countsSchema,
  truncated: z.boolean(),
  untrusted_fields: z.array(z.string()),
  notices: z.array(z.string()),
});
export type ReplyOutput = z.infer<typeof outputSchema>;

const RESPONDER_GROUPINGS = new Set<ReplyGrouping>(["responder", "responder_day", "thread_responder"]);

function replyWhere(ctx: DataAccessContext, input: ReplyInput, from: string, to: string, responderLayer: boolean): SqlPart {
  const parts: string[] = ["r.metric_date >= ?", "r.metric_date <= ?", responderLayer ? "r.responder_uid <> ''" : "r.responder_uid = ''"];
  const params: unknown[] = [from, to];
  const visible = threadVisibilitySql(ctx, "g");
  parts.push(`(${visible.sql})`);
  params.push(...visible.params);
  if (input.thread_ids?.length) {
    parts.push("r.group_id IN (?)");
    params.push([...new Set(input.thread_ids)]);
  }
  const accounts = threadOfAccountsCondition([...new Set(input.account_ids ?? [])]);
  if (accounts) {
    parts.push(`(${accounts.sql})`);
    params.push(...accounts.params);
  }
  if (responderLayer && input.responder_uids?.length) {
    parts.push("r.responder_uid IN (?)");
    params.push([...new Set(input.responder_uids)]);
  }
  if (responderLayer && input.responder_name) {
    assertNoPersonalNumberProbe(ctx, "responder_name", input.responder_name);
    parts.push("r.responder_name LIKE ?");
    params.push(`%${escapeLikeText(input.responder_name.trim())}%`);
  }
  return { sql: parts.join(" AND "), params };
}

const GROUPING_SQL: Record<ReplyGrouping, { select: string; groupBy: string; orderBy: string }> = {
  thread_day: {
    select: `r.group_id AS thread_id, ${THREAD_NAME} AS thread_name, NULL AS responder_uid, NULL AS responder_name, r.metric_date AS metric_day`,
    groupBy: "r.group_id, r.metric_date", orderBy: "metric_day DESC, episodes DESC, thread_id",
  },
  thread: {
    select: `r.group_id AS thread_id, ${THREAD_NAME} AS thread_name, NULL AS responder_uid, NULL AS responder_name, NULL AS metric_day`,
    groupBy: "r.group_id", orderBy: "episodes DESC, thread_id",
  },
  day: {
    select: "NULL AS thread_id, NULL AS thread_name, NULL AS responder_uid, NULL AS responder_name, r.metric_date AS metric_day",
    groupBy: "r.metric_date", orderBy: "metric_day DESC",
  },
  responder: {
    select: "NULL AS thread_id, NULL AS thread_name, r.responder_uid AS responder_uid, MAX(r.responder_name) AS responder_name, NULL AS metric_day",
    groupBy: "r.responder_uid", orderBy: "answered DESC, responder_uid",
  },
  responder_day: {
    select: "NULL AS thread_id, NULL AS thread_name, r.responder_uid AS responder_uid, MAX(r.responder_name) AS responder_name, r.metric_date AS metric_day",
    groupBy: "r.responder_uid, r.metric_date", orderBy: "metric_day DESC, answered DESC, responder_uid",
  },
  thread_responder: {
    select: `r.group_id AS thread_id, ${THREAD_NAME} AS thread_name, r.responder_uid AS responder_uid, MAX(r.responder_name) AS responder_name, NULL AS metric_day`,
    groupBy: "r.group_id, r.responder_uid", orderBy: "answered DESC, thread_id, responder_uid",
  },
};

const SUMS_SQL = `SUM(r.customer_messages) AS customer_messages, SUM(r.episodes) AS episodes, SUM(r.answered) AS answered, SUM(r.answered_late) AS answered_late,
  SUM(r.open_episodes) AS open_episodes, SUM(r.open_overdue) AS open_overdue, SUM(r.wait_sum_sec) AS wait_sum_sec, MAX(r.wait_max_sec) AS wait_max_sec,
  SUM(r.work_wait_sum_sec) AS work_wait_sum_sec, MAX(r.work_wait_max_sec) AS work_wait_max_sec, SUM(r.staff_messages) AS staff_messages,
  SUM(r.assistant_replies) AS assistant_replies, MAX(r.sla_minutes) AS sla_minutes, MAX(r.computed_at) AS computed_at`;
const FROM_SQL = "FROM reply_metric_daily r JOIN zalo_group g ON g.id = r.group_id";

const count = (value: unknown): number => Number(value ?? 0) || 0;
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const minutes = (seconds: number, divisor: number): number | null => (divisor > 0 ? Math.round((seconds / divisor / 60) * 10) / 10 : null);
const dayText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return dbDateToVnIso(value)?.slice(0, 10) ?? null;
  return String(value).slice(0, 10);
};

function shapeCounts(row: RowDataPacket): z.infer<typeof countsSchema> {
  const answered = count(row.answered);
  const late = count(row.answered_late);
  return {
    customer_messages: count(row.customer_messages), episodes: count(row.episodes), answered, answered_late: late,
    open_episodes: count(row.open_episodes), open_overdue: count(row.open_overdue),
    on_time_rate: answered ? Math.round(((answered - late) / answered) * 1000) / 1000 : null,
    avg_wait_minutes: minutes(count(row.wait_sum_sec), answered), max_wait_minutes: answered ? minutes(count(row.wait_max_sec), 1) : null,
    avg_work_wait_minutes: minutes(count(row.work_wait_sum_sec), answered), max_work_wait_minutes: answered ? minutes(count(row.work_wait_max_sec), 1) : null,
    staff_messages: count(row.staff_messages), assistant_replies: count(row.assistant_replies),
  };
}

export async function collectReplyMetrics(ctx: DataAccessContext, input: ReplyInput, maxRows: number): Promise<ReplyOutput> {
  const period = resolveActivityPeriod(input, ctx.now);
  const groupBy = input.group_by ?? "thread_day";
  const responderLayer = RESPONDER_GROUPINGS.has(groupBy);
  const where = replyWhere(ctx, input, period.from, period.to, responderLayer);
  // Tổng của kỳ luôn đọc lớp TỔNG của cuộc (không lọc theo người) — tỷ lệ đúng hạn chung không phụ thuộc kiểu gộp
  const totalsWhere = replyWhere(ctx, { ...input, responder_uids: undefined, responder_name: undefined }, period.from, period.to, false);
  const grouping = GROUPING_SQL[groupBy];
  let rows: RowDataPacket[];
  let totals: RowDataPacket[];
  try {
    [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT ${QUERY_TIME_HINT} ${grouping.select}, ${SUMS_SQL} ${FROM_SQL} WHERE ${where.sql} GROUP BY ${grouping.groupBy} ORDER BY ${grouping.orderBy} LIMIT ${maxRows + 1}`,
      where.params);
    [totals] = await ctx.db.query<RowDataPacket[]>(`SELECT ${QUERY_TIME_HINT} ${SUMS_SQL} ${FROM_SQL} WHERE ${totalsWhere.sql}`, totalsWhere.params);
  } catch (error) {
    return translateDbError(error);
  }
  const truncated = rows.length > maxRows;
  const shaped: ReplyRow[] = rows.slice(0, maxRows).map((row) => ({
    thread_id: row.thread_id === null || row.thread_id === undefined ? null : Number(row.thread_id),
    thread_name: text(row.thread_name), responder_uid: text(row.responder_uid), responder_name: text(row.responder_name), day: dayText(row.metric_day),
    ...shapeCounts(row),
  }));
  const total = totals[0] ?? {};
  const notices: string[] = [];
  if (truncated) notices.push(`Chỉ trả ${maxRows} dòng đầu — thu hẹp kỳ, lọc nhóm / người, hoặc đổi kiểu gộp.`);
  if (responderLayer) notices.push("Kiểu gộp theo nhân viên: customer_messages / episodes / open_* luôn 0 ở từng dòng (thuộc lớp tổng của cuộc); xem totals.");
  if (!count(total.episodes) && !count(total.staff_messages)) notices.push("Chưa có số liệu trong kỳ — việc nền tính mỗi 30 phút; ngày cũ cần quản trị chạy lệnh reply-metrics --days N.");
  return {
    period: { from: period.from, to: period.to, days: period.days }, group_by: groupBy,
    sla_minutes: total.sla_minutes === null || total.sla_minutes === undefined ? null : count(total.sla_minutes),
    computed_at: dbDateToVnIso(total.computed_at), rows: shaped, totals: shapeCounts(total as RowDataPacket), truncated,
    untrusted_fields: ["rows.thread_name", "rows.responder_name"], notices,
  };
}

export const replyMetricsTool: ToolDefinition<ReplyInput, ReplyOutput> = {
  name: "reply_metrics",
  title: "Chỉ số phản hồi khách theo kỳ",
  description:
    "Chỉ số PHẢN HỒI KHÁCH tính sẵn theo ngày (mặc định 7 ngày gần nhất, tối đa 92 ngày): một «lượt chờ» = khách nhắn tới khi nhân viên đầu tiên " +
    "trả lời. Mỗi dòng (nhóm × ngày, nhóm, ngày, nhân viên, nhân viên × ngày, nhóm × nhân viên) có: tin khách, số lượt, đã trả lời, trả lời trễ, " +
    "đang chờ, chờ quá hạn, tỷ lệ đúng hạn, chờ trung bình / lâu nhất theo giờ thường và theo GIỜ LÀM VIỆC (phút), tin nhân viên, lượt bot AI tự trả lời; " +
    "kèm totals và sla_minutes (ngưỡng trễ, phút làm việc). Dùng khi sếp hỏi 'nhóm nào trả lời khách chậm', 'ai trả lời nhiều / nhanh nhất', " +
    "'tuần này bao nhiêu tin khách bị bỏ sót', 'tỷ lệ đúng hạn từng nhóm'. Nhân viên = Danh bạ loại Nhân viên + tài khoản bot; nhóm nội bộ không tính. " +
    "Cần dẫn chứng từng tin thì gọi tiếp search_messages / get_thread_messages với thread_id và ngày tương ứng. " +
    `Số liệu do việc nền tính mỗi 30 phút (computed_at), không phải thời gian thực. ${UNTRUSTED_NOTICE}`,
  input: () => replyInputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const result = await collectReplyMetrics(ctx, input, input.max_rows ?? REPLY_DEFAULT_ROWS);
    const t = result.totals;
    const rate = t.on_time_rate === null ? "—" : `${Math.round(t.on_time_rate * 100)}%`;
    const summary = `Phản hồi ${result.period.from} → ${result.period.to}: ${t.episodes} lượt khách chờ, ${t.answered} đã trả lời (${t.answered_late} trễ), ` +
      `${t.open_episodes} đang chờ (${t.open_overdue} quá hạn), đúng hạn ${rate}, chờ TB ${t.avg_work_wait_minutes ?? "—"} phút làm việc; ${result.rows.length} dòng${result.truncated ? " (đã cắt)" : ""}.`;
    return { structured: result, summary, rowCount: result.rows.length, entity: "messages" };
  },
};
