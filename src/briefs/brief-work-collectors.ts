import type { RowDataPacket } from "mysql2";
import { TaskStatus, TicketStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { vnLocalTime, type WorkCalendar } from "../schedule/work-calendar.js";
import { GROUP_NAME_SQL, toBriefLine } from "./brief-row-helpers.js";
import { workScopeSql } from "./brief-scope.js";
import type { BriefLine, BriefPeriod, BriefScope, Bucket } from "./brief-types.js";

// Bộ gom việc / ticket cho bản tin. Việc và ticket không gắn nhóm theo cột group_id như tin — theo luật màn «Việc»
// (chốt 09/10/2026): người nhận «mọi nhóm» mới thấy việc / ticket KHÔNG gắn nhóm (source_thread_id NULL); người nhận
// giới hạn nhóm chỉ thấy thêm việc / ticket mà chính họ là người giao / phụ trách (việc) hoặc người gửi / người xử lý
// (ticket), NGOÀI những cái gắn đúng nhóm họ theo dõi. Luật phạm vi (`workScopeSql`) dùng CHUNG với sheet «Theo nhân
// viên» của báo cáo tuần / tháng (reports/periodic-report-work-stats.ts) — xem brief-scope.ts (review phase 8, H1).

const DAY_MS = 86_400_000;

async function workBucket(db: Db, from: string, where: string, params: unknown[], columns: string, orderSql: string, limit: number): Promise<Bucket<BriefLine>> {
  const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`, params);
  const total = Number(countRows[0]?.total ?? 0);
  if (!total) return { total: 0, items: [] };
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${columns} FROM ${from} WHERE ${where} ORDER BY ${orderSql} LIMIT ?`, [...params, limit]);
  return { total, items: rows.map(toBriefLine) };
}

export interface TaskBuckets {
  overdue: Bucket<BriefLine>;
  dueToday: Bucket<BriefLine>;
  dueNextWorkingDay: Bucket<BriefLine>;
  doneInPeriod: Bucket<BriefLine>;
}

const TASK_FROM = "task t LEFT JOIN zalo_group g ON g.id = t.source_thread_id";
/** Khớp `isTaskOverdue` (task-format.ts): đang làm + đã qua mốc hết hạn (giờ nếu có, hết ngày nếu chỉ có ngày). */
const TASK_OVERDUE_SQL = "t.due_at IS NOT NULL AND IF(t.due_has_time = 1, t.due_at, t.due_at + INTERVAL 1 DAY) <= ?";
const taskColumns = (dateExpr: string) => `t.id, ${GROUP_NAME_SQL} AS group_name, t.assignee_name AS sender_name, ${dateExpr} AS at, t.title AS text`;

/** Việc: quá hạn, hạn hôm nay, hạn ngày làm việc kế tiếp (không lọc theo kỳ — trạng thái HIỆN TẠI), xong trong kỳ. */
export async function taskBuckets(db: Db, scope: BriefScope, period: BriefPeriod, calendar: WorkCalendar, now = new Date(), limit = 20): Promise<TaskBuckets> {
  const scopeFilter = workScopeSql(scope, { thread: "t.source_thread_id", parties: ["t.assignee_uid", "t.assigner_uid"] });
  const todayStart = new Date(vnLocalTime(now).dayStartMs);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  const nextWorkStart = calendar.nextWorkingDay(now) ?? tomorrowStart;
  const nextWorkEnd = new Date(nextWorkStart.getTime() + DAY_MS);

  const [overdue, dueToday, dueNextWorkingDay, doneInPeriod] = await Promise.all([
    workBucket(db, TASK_FROM,
      `t.status = ? AND ${TASK_OVERDUE_SQL} AND ${scopeFilter.sql}`, [TaskStatus.Open, now, ...scopeFilter.params],
      taskColumns("t.due_at"), "t.due_at", limit),
    workBucket(db, TASK_FROM,
      `t.status = ? AND t.due_at >= ? AND t.due_at < ? AND NOT (${TASK_OVERDUE_SQL}) AND ${scopeFilter.sql}`,
      [TaskStatus.Open, todayStart, tomorrowStart, now, ...scopeFilter.params], taskColumns("t.due_at"), "t.due_at", limit),
    workBucket(db, TASK_FROM,
      `t.status = ? AND t.due_at >= ? AND t.due_at < ? AND ${scopeFilter.sql}`,
      [TaskStatus.Open, nextWorkStart, nextWorkEnd, ...scopeFilter.params], taskColumns("t.due_at"), "t.due_at", limit),
    workBucket(db, TASK_FROM,
      `t.status = ? AND t.closed_at >= ? AND t.closed_at < ? AND ${scopeFilter.sql}`,
      [TaskStatus.Done, period.from, period.to, ...scopeFilter.params], taskColumns("t.closed_at"), "t.closed_at DESC", limit),
  ]);
  return { overdue, dueToday, dueNextWorkingDay, doneInPeriod };
}

export interface TicketBuckets {
  newInPeriod: Bucket<BriefLine>;
  closedInPeriod: Bucket<BriefLine>;
  open: Bucket<BriefLine>;
}

const TICKET_FROM = "ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id LEFT JOIN contact hc ON hc.id = t.handler_contact_id";
const ticketColumns = (dateExpr: string, nameExpr: string) => `t.id, ${GROUP_NAME_SQL} AS group_name, ${nameExpr} AS sender_name, ${dateExpr} AS at, t.title AS text`;

/** Ticket: mới trong kỳ, đóng trong kỳ, đang mở (New / InProgress — không lọc theo kỳ, trạng thái HIỆN TẠI). */
export async function ticketBuckets(db: Db, scope: BriefScope, period: BriefPeriod, limit = 20): Promise<TicketBuckets> {
  const scopeFilter = workScopeSql(scope, { thread: "t.source_thread_id", parties: ["t.requester_uid", "hc.zalo_uid"] });

  const [newInPeriod, closedInPeriod, open] = await Promise.all([
    workBucket(db, TICKET_FROM,
      `t.created_at >= ? AND t.created_at < ? AND ${scopeFilter.sql}`, [period.from, period.to, ...scopeFilter.params],
      ticketColumns("t.created_at", "t.requester_name"), "t.created_at DESC", limit),
    workBucket(db, TICKET_FROM,
      `t.status IN (?, ?) AND t.closed_at >= ? AND t.closed_at < ? AND ${scopeFilter.sql}`,
      [TicketStatus.Done, TicketStatus.Cancelled, period.from, period.to, ...scopeFilter.params],
      ticketColumns("t.closed_at", "COALESCE(NULLIF(t.handler_name, ''), t.requester_name)"), "t.closed_at DESC", limit),
    workBucket(db, TICKET_FROM,
      `t.status IN (?, ?) AND ${scopeFilter.sql}`, [TicketStatus.New, TicketStatus.InProgress, ...scopeFilter.params],
      ticketColumns("t.created_at", "t.requester_name"), "t.created_at", limit),
  ]);
  return { newInPeriod, closedInPeriod, open };
}
