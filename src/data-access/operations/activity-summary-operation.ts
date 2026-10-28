import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { MessageKind } from "../../constants.js";
import { escapeLikeText, type SqlPart } from "../../web/api/list-query.js";
import { threadOfAccountsCondition } from "../../web/api/conversation-accounts.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { assertNoPersonalNumberProbe } from "../masked-filter-guard.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { dbDateToVnIso, nextVnDay, parseVnInstant, spanDays, toVnIso } from "../vn-time.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// activity_summary (phase 13.4, 28/10/2026): tổng hợp HOẠT ĐỘNG tin nhắn theo kỳ cho sếp hỏi qua MCP — gộp nhóm × ngày, người gửi × ngày
// hoặc nhóm × người: số tin, số tệp, số người hoạt động, số cuộc, giờ tin cuối. Cùng luật thấy cuộc với messages (threadVisibilitySql: phạm
// vi nhóm, nhóm Mật theo cờ khóa, chỉ cuộc riêng của chính mình), không tính tin đã thu hồi và dòng sự kiện nhóm. Lọc tài khoản Zalo dùng
// chung hàm SQL với màn Hội thoại. Lõi `collectActivitySummary` dùng lại cho export_report (trần dòng lớn hơn).

export const ACTIVITY_GROUPINGS = ["thread_day", "sender_day", "thread_sender"] as const;
export type ActivityGrouping = (typeof ACTIVITY_GROUPINGS)[number];
export const ACTIVITY_DEFAULT_DAYS = 7;
export const ACTIVITY_MAX_DAYS = 92;
export const ACTIVITY_DEFAULT_ROWS = 200;
export const ACTIVITY_MAX_ROWS = 1000;
const MAX_FILTER_VALUES = 200;

const TO_VN_DAY = "DATE_FORMAT(CONVERT_TZ(m.sent_at, '+00:00', '+07:00'), '%Y-%m-%d')";
const THREAD_NAME = "MAX(COALESCE(NULLIF(g.label, ''), g.name))";

export const activityInputSchema = z.object({
  from: z.string().max(10).optional().describe(`Từ ngày 'YYYY-MM-DD' (giờ VN). Bỏ trống = ${ACTIVITY_DEFAULT_DAYS} ngày gần nhất tính tới hôm nay.`),
  to: z.string().max(10).optional().describe(`Đến ngày 'YYYY-MM-DD', tính CẢ ngày này. Bỏ trống = hôm nay. Tối đa ${ACTIVITY_MAX_DAYS} ngày một lần.`),
  group_by: z.enum(ACTIVITY_GROUPINGS).optional()
    .describe("thread_day = mỗi nhóm / cuộc × ngày (mặc định); sender_day = mỗi người gửi × ngày; thread_sender = mỗi nhóm × người gửi (cả kỳ)."),
  thread_ids: z.array(z.number().int().positive()).max(MAX_FILTER_VALUES).optional().describe("Chỉ các nhóm / cuộc này (id của groups / conversations)."),
  account_ids: z.array(z.number().int().positive()).max(MAX_FILTER_VALUES).optional().describe("Chỉ cuộc thuộc các tài khoản Zalo này của bot (id ở whoami)."),
  sender_uids: z.array(z.string().min(1).max(40)).max(MAX_FILTER_VALUES).optional().describe("Chỉ tin của các người gửi này (sender_uid)."),
  sender_name: z.string().min(2).max(80).optional().describe("Chỉ người gửi có tên chứa chuỗi này."),
  max_rows: z.number().int().min(1).max(ACTIVITY_MAX_ROWS).optional().describe(`Số dòng tối đa (mặc định ${ACTIVITY_DEFAULT_ROWS}, tối đa ${ACTIVITY_MAX_ROWS}).`),
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

const rowSchema = z.object({
  thread_id: z.number().nullable(),
  thread_name: z.string().nullable(),
  sender_uid: z.string().nullable(),
  sender_name: z.string().nullable(),
  day: z.string().nullable(),
  messages: z.number(),
  files: z.number(),
  active_senders: z.number(),
  threads: z.number(),
  last_message_at: z.string().nullable(),
});
export type ActivityRow = z.infer<typeof rowSchema>;

const totalsSchema = z.object({
  messages: z.number(), files: z.number(), active_senders: z.number(), threads: z.number(), last_message_at: z.string().nullable(),
});

const outputSchema = z.object({
  period: z.object({ from: z.string(), to: z.string(), days: z.number() }),
  group_by: z.enum(ACTIVITY_GROUPINGS),
  rows: z.array(rowSchema),
  totals: totalsSchema,
  truncated: z.boolean(),
  untrusted_fields: z.array(z.string()),
  notices: z.array(z.string()),
});
export type ActivityOutput = z.infer<typeof outputSchema>;

/** Kỳ báo cáo theo ngày VN: [start, end) cho SQL + nhãn 'YYYY-MM-DD'. Hàm thuần (chỉ đọc `now`). */
export function resolveActivityPeriod(input: Pick<ActivityInput, "from" | "to">, now: Date): { start: Date; end: Date; from: string; to: string; days: number } {
  const parseDay = (raw: string, field: string) => {
    const parsed = parseVnInstant(raw);
    if (!parsed || !parsed.dayOnly) throw new DataAccessError("invalid_value", `${field} phải là ngày 'YYYY-MM-DD'.`);
    return parsed.date;
  };
  const today = parseVnInstant(toVnIso(now).slice(0, 10))!.date;
  const toDay = input.to ? parseDay(input.to, "to") : today;
  const fromDay = input.from ? parseDay(input.from, "from") : new Date(toDay.getTime() - (ACTIVITY_DEFAULT_DAYS - 1) * 86_400_000);
  const end = nextVnDay(toDay);
  if (fromDay.getTime() >= end.getTime()) throw new DataAccessError("invalid_value", "from phải trước hoặc bằng to.");
  const days = spanDays(fromDay, end);
  if (days > ACTIVITY_MAX_DAYS) throw new DataAccessError("invalid_value", `Kỳ tối đa ${ACTIVITY_MAX_DAYS} ngày — chia nhỏ kỳ hoặc gộp theo nhóm × người.`);
  return { start: fromDay, end, from: toVnIso(fromDay).slice(0, 10), to: toVnIso(toDay).slice(0, 10), days };
}

/** Điều kiện chung (kỳ + phạm vi thấy + bộ lọc) cho câu gộp và câu tổng. */
function activityWhere(ctx: DataAccessContext, input: ActivityInput, start: Date, end: Date): SqlPart {
  const parts: string[] = ["m.recalled_at IS NULL", `m.kind <> ${MessageKind.System}`, "m.sent_at >= ?", "m.sent_at < ?"];
  const params: unknown[] = [start, end];
  const visible = threadVisibilitySql(ctx, "g");
  parts.push(`(${visible.sql})`);
  params.push(...visible.params);
  if (input.thread_ids?.length) {
    parts.push("m.group_id IN (?)");
    params.push([...new Set(input.thread_ids)]);
  }
  const accounts = threadOfAccountsCondition([...new Set(input.account_ids ?? [])]);
  if (accounts) {
    parts.push(`(${accounts.sql})`);
    params.push(...accounts.params);
  }
  if (input.sender_uids?.length) {
    parts.push("m.sender_uid IN (?)");
    params.push([...new Set(input.sender_uids)]);
  }
  if (input.sender_name) {
    // Che bật: không cho dò SĐT nằm trong tên Zalo bằng bộ lọc (như các công cụ tìm khác)
    assertNoPersonalNumberProbe(ctx, "sender_name", input.sender_name);
    parts.push("m.sender_name LIKE ?");
    params.push(`%${escapeLikeText(input.sender_name.trim())}%`);
  }
  return { sql: parts.join(" AND "), params };
}

const GROUPING_SQL: Record<ActivityGrouping, { select: string; groupBy: string; orderBy: string }> = {
  thread_day: {
    select: `m.group_id AS thread_id, ${THREAD_NAME} AS thread_name, NULL AS sender_uid, NULL AS sender_name, ${TO_VN_DAY} AS activity_day`,
    groupBy: `m.group_id, ${TO_VN_DAY}`, orderBy: "activity_day DESC, messages DESC, thread_id",
  },
  sender_day: {
    select: `NULL AS thread_id, NULL AS thread_name, m.sender_uid AS sender_uid, MAX(m.sender_name) AS sender_name, ${TO_VN_DAY} AS activity_day`,
    groupBy: `m.sender_uid, ${TO_VN_DAY}`, orderBy: "activity_day DESC, messages DESC, sender_uid",
  },
  thread_sender: {
    select: `m.group_id AS thread_id, ${THREAD_NAME} AS thread_name, m.sender_uid AS sender_uid, MAX(m.sender_name) AS sender_name, NULL AS activity_day`,
    groupBy: "m.group_id, m.sender_uid", orderBy: "messages DESC, thread_id, sender_uid",
  },
};

const COUNTS_SQL = "COUNT(*) AS messages, COUNT(a.id) AS files, COUNT(DISTINCT m.sender_uid) AS active_senders, COUNT(DISTINCT m.group_id) AS threads, MAX(m.sent_at) AS last_message_at";
const FROM_SQL = "FROM message m JOIN zalo_group g ON g.id = m.group_id LEFT JOIN attachment a ON a.message_id = m.id";

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const count = (value: unknown): number => Number(value ?? 0) || 0;

/** Chạy hai câu (gộp + tổng) — `maxRows` là trần dòng (lấy dư 1 để biết có bị cắt). Lõi cho cả activity_summary và export_report. */
export async function collectActivitySummary(ctx: DataAccessContext, input: ActivityInput, maxRows: number): Promise<ActivityOutput> {
  const period = resolveActivityPeriod(input, ctx.now);
  const groupBy = input.group_by ?? "thread_day";
  const where = activityWhere(ctx, input, period.start, period.end);
  const grouping = GROUPING_SQL[groupBy];
  let rows: RowDataPacket[];
  let totals: RowDataPacket[];
  try {
    [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT ${QUERY_TIME_HINT} ${grouping.select}, ${COUNTS_SQL} ${FROM_SQL} WHERE ${where.sql}
       GROUP BY ${grouping.groupBy} ORDER BY ${grouping.orderBy} LIMIT ${maxRows + 1}`, where.params);
    [totals] = await ctx.db.query<RowDataPacket[]>(`SELECT ${QUERY_TIME_HINT} ${COUNTS_SQL} ${FROM_SQL} WHERE ${where.sql}`, where.params);
  } catch (error) {
    return translateDbError(error);
  }
  const truncated = rows.length > maxRows;
  const shaped: ActivityRow[] = rows.slice(0, maxRows).map((row) => ({
    thread_id: row.thread_id === null || row.thread_id === undefined ? null : Number(row.thread_id),
    thread_name: text(row.thread_name), sender_uid: text(row.sender_uid), sender_name: text(row.sender_name), day: text(row.activity_day),
    messages: count(row.messages), files: count(row.files), active_senders: count(row.active_senders), threads: count(row.threads),
    last_message_at: dbDateToVnIso(row.last_message_at),
  }));
  const total = totals[0] ?? {};
  const notices: string[] = [];
  if (truncated) notices.push(`Chỉ trả ${maxRows} dòng đầu (xếp theo ngày mới / nhiều tin trước) — thu hẹp kỳ, lọc nhóm / người, hoặc đổi group_by. Mục totals vẫn là tổng ĐỦ của cả kỳ.`);
  return {
    period: { from: period.from, to: period.to, days: period.days }, group_by: groupBy, rows: shaped,
    totals: {
      messages: count(total.messages), files: count(total.files), active_senders: count(total.active_senders), threads: count(total.threads),
      last_message_at: dbDateToVnIso(total.last_message_at),
    },
    truncated, untrusted_fields: ["rows.thread_name", "rows.sender_name"], notices,
  };
}

export const activitySummaryTool: ToolDefinition<ActivityInput, ActivityOutput> = {
  name: "activity_summary",
  title: "Tổng hợp hoạt động theo kỳ",
  description:
    "Tổng hợp hoạt động tin nhắn Zalo theo kỳ (mặc định 7 ngày gần nhất, tối đa 92 ngày): mỗi dòng là nhóm × ngày, người gửi × ngày hoặc " +
    "nhóm × người, có số tin, số tệp / ảnh, số người hoạt động, số cuộc, giờ tin cuối; kèm totals của cả kỳ. Dùng khi sếp hỏi 'tuần này nhóm nào " +
    "sôi nổi nhất', 'ai nhắn nhiều nhất', 'nhóm X mỗi ngày bao nhiêu tin', 'nhân viên A hoạt động ở những nhóm nào'. Lọc theo nhóm (thread_ids), " +
    "tài khoản Zalo của bot (account_ids), người gửi (sender_uids / sender_name). Không tính tin đã thu hồi và dòng sự kiện nhóm. Muốn tệp Excel / " +
    `PDF thì gọi export_report với source = activity_summary và cùng tham số. ${UNTRUSTED_NOTICE}`,
  input: () => activityInputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const result = await collectActivitySummary(ctx, input, input.max_rows ?? ACTIVITY_DEFAULT_ROWS);
    const summary = `Hoạt động ${result.period.from} → ${result.period.to}: ${result.totals.messages} tin, ${result.totals.files} tệp, ` +
      `${result.totals.active_senders} người, ${result.totals.threads} cuộc; ${result.rows.length} dòng${result.truncated ? " (đã cắt)" : ""}.`;
    return { structured: result, summary, rowCount: result.rows.length, entity: "messages" };
  },
};
