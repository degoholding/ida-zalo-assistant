import type { RowDataPacket } from "mysql2";
import { GROUP_NAME_SQL } from "../briefs/brief-row-helpers.js";
import { workScopeSql } from "../briefs/brief-scope.js";
import { TaskStatus, TicketStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { BriefPeriod, BriefScope } from "../briefs/brief-types.js";
import type { MetricPair, PeriodicReportTotals, StaffReportRow, WorkReportRow } from "./periodic-report-types.js";

// Số liệu VIỆC / TICKET + «Theo nhân viên» của báo cáo tuần / tháng (phase 3). «Còn mở tại mốc cutoff» dựng lại từ
// `created_at` / `closed_at` (đóng lại thì `closed_at = NULL`, xem task-service.ts / ticket-service.ts) thay vì đọc cột
// `status` hiện tại — đúng cho MỌI mốc trong quá khứ, kể cả việc / ticket đã xong rồi mở lại. Luật phạm vi
// (`workScopeSql`, brief-scope.ts) dùng CHUNG với bộ gom việc / ticket của bản tin (brief-work-collectors.ts) —
// review phase 8, H1: sheet «Theo nhân viên» (doneRows / overdueRows) áp cùng luật, không chỉ lọc theo `assignee_uid`.
/** Khớp `isTaskOverdue` (task-format.ts): đang mở + đã qua mốc hết hạn (giờ nếu có, hết ngày nếu chỉ có ngày). */
const TASK_OVERDUE_AT_SQL = "t.due_at IS NOT NULL AND IF(t.due_has_time = 1, t.due_at, t.due_at + INTERVAL 1 DAY) <= ?";
/** Còn mở tại mốc `cutoff`: đã tồn tại (tạo trước/đúng cutoff) và chưa đóng tại thời điểm đó. */
const OPEN_AT_SQL = "t.created_at <= ? AND (t.closed_at IS NULL OR t.closed_at >= ?)";

async function count(db: Db, from: string, where: string, params: unknown[]): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`, params);
  return Number(rows[0]?.total ?? 0);
}

const pair = (current: number, previous: number): MetricPair => ({ current, previous });

export interface WorkStatsResult {
  totals: Pick<PeriodicReportTotals, "tasksCreated" | "tasksDone" | "tasksDoneLate" | "tasksOverdueOpen" | "ticketsCreated" | "ticketsClosed" | "ticketsOpen">;
  tasks: WorkReportRow[];
  tickets: WorkReportRow[];
}

/** Việc + ticket của kỳ: tổng số (kỳ này so kỳ trước) + danh sách dòng (trần 1.000, áp ở `buildReportWorkbook`). */
export async function collectWorkStats(db: Db, scope: BriefScope, period: BriefPeriod, now: Date): Promise<WorkStatsResult> {
  const taskScope = workScopeSql(scope, { thread: "t.source_thread_id", parties: ["t.assignee_uid", "t.assigner_uid"] });
  const ticketScope = workScopeSql(scope, { thread: "t.source_thread_id", parties: ["t.requester_uid", "hc.zalo_uid"] });
  const TASK_FROM = "task t LEFT JOIN zalo_group g ON g.id = t.source_thread_id";
  const TICKET_FROM = "ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id LEFT JOIN contact hc ON hc.id = t.handler_contact_id";

  const [tasksCreatedNow, tasksCreatedPrev, tasksDoneNow, tasksDonePrev, tasksDoneLateNow, tasksDoneLatePrev,
    tasksOverdueNow, tasksOverduePrev, ticketsCreatedNow, ticketsCreatedPrev, ticketsClosedNow, ticketsClosedPrev,
    ticketsOpenNow, ticketsOpenPrev] = await Promise.all([
    // Đề xuất (Proposed) chưa được xác nhận thành việc thật — không tính vào «việc mới tạo» (review phase 8, M5)
    count(db, TASK_FROM, `t.status <> ? AND t.created_at >= ? AND t.created_at < ? AND ${taskScope.sql}`,
      [TaskStatus.Proposed, period.from, period.to, ...taskScope.params]),
    count(db, TASK_FROM, `t.status <> ? AND t.created_at >= ? AND t.created_at < ? AND ${taskScope.sql}`,
      [TaskStatus.Proposed, period.previous.from, period.previous.to, ...taskScope.params]),
    count(db, TASK_FROM, `t.status = ? AND t.closed_at >= ? AND t.closed_at < ? AND ${taskScope.sql}`, [TaskStatus.Done, period.from, period.to, ...taskScope.params]),
    count(db, TASK_FROM, `t.status = ? AND t.closed_at >= ? AND t.closed_at < ? AND ${taskScope.sql}`, [TaskStatus.Done, period.previous.from, period.previous.to, ...taskScope.params]),
    count(db, TASK_FROM, `t.status = ? AND t.closed_at >= ? AND t.closed_at < ? AND t.due_at IS NOT NULL AND t.closed_at > IF(t.due_has_time = 1, t.due_at, t.due_at + INTERVAL 1 DAY) AND ${taskScope.sql}`,
      [TaskStatus.Done, period.from, period.to, ...taskScope.params]),
    count(db, TASK_FROM, `t.status = ? AND t.closed_at >= ? AND t.closed_at < ? AND t.due_at IS NOT NULL AND t.closed_at > IF(t.due_has_time = 1, t.due_at, t.due_at + INTERVAL 1 DAY) AND ${taskScope.sql}`,
      [TaskStatus.Done, period.previous.from, period.previous.to, ...taskScope.params]),
    count(db, TASK_FROM, `${OPEN_AT_SQL} AND ${TASK_OVERDUE_AT_SQL} AND ${taskScope.sql}`, [now, now, now, ...taskScope.params]),
    count(db, TASK_FROM, `${OPEN_AT_SQL} AND ${TASK_OVERDUE_AT_SQL} AND ${taskScope.sql}`, [period.previous.to, period.previous.to, period.previous.to, ...taskScope.params]),
    count(db, TICKET_FROM, `t.created_at >= ? AND t.created_at < ? AND ${ticketScope.sql}`, [period.from, period.to, ...ticketScope.params]),
    count(db, TICKET_FROM, `t.created_at >= ? AND t.created_at < ? AND ${ticketScope.sql}`, [period.previous.from, period.previous.to, ...ticketScope.params]),
    count(db, TICKET_FROM, `t.status IN (?, ?) AND t.closed_at >= ? AND t.closed_at < ? AND ${ticketScope.sql}`,
      [TicketStatus.Done, TicketStatus.Cancelled, period.from, period.to, ...ticketScope.params]),
    count(db, TICKET_FROM, `t.status IN (?, ?) AND t.closed_at >= ? AND t.closed_at < ? AND ${ticketScope.sql}`,
      [TicketStatus.Done, TicketStatus.Cancelled, period.previous.from, period.previous.to, ...ticketScope.params]),
    count(db, TICKET_FROM, `${OPEN_AT_SQL} AND ${ticketScope.sql}`, [now, now, ...ticketScope.params]),
    count(db, TICKET_FROM, `${OPEN_AT_SQL} AND ${ticketScope.sql}`, [period.previous.to, period.previous.to, ...ticketScope.params]),
  ]);

  const [tasks, tickets] = await Promise.all([
    taskRows(db, taskScope, period),
    ticketRows(db, ticketScope, period),
  ]);

  return {
    totals: {
      tasksCreated: pair(tasksCreatedNow, tasksCreatedPrev),
      tasksDone: pair(tasksDoneNow, tasksDonePrev),
      tasksDoneLate: pair(tasksDoneLateNow, tasksDoneLatePrev),
      tasksOverdueOpen: pair(tasksOverdueNow, tasksOverduePrev),
      ticketsCreated: pair(ticketsCreatedNow, ticketsCreatedPrev),
      ticketsClosed: pair(ticketsClosedNow, ticketsClosedPrev),
      ticketsOpen: pair(ticketsOpenNow, ticketsOpenPrev),
    },
    tasks, tickets,
  };
}

const TASK_STATUS_LABEL: Record<number, string> = { [TaskStatus.Proposed]: "Đề xuất", [TaskStatus.Open]: "Đang làm", [TaskStatus.Done]: "Xong", [TaskStatus.Cancelled]: "Đã hủy" };
const TICKET_STATUS_LABEL: Record<number, string> = { [TicketStatus.New]: "Mới", [TicketStatus.InProgress]: "Đang xử lý", [TicketStatus.Done]: "Xong", [TicketStatus.Cancelled]: "Đã hủy" };
const WORK_LIST_LIMIT = 1000;

/** Việc chạm tới trong kỳ (tạo HOẶC đóng trong kỳ) — danh sách sheet phụ «Việc». */
async function taskRows(db: Db, taskScope: { sql: string; params: unknown[] }, period: BriefPeriod): Promise<WorkReportRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.code, t.title, t.status, ${GROUP_NAME_SQL} AS group_name, t.assignee_name AS person_name,
       COALESCE(t.closed_at, t.created_at) AS at
     FROM task t LEFT JOIN zalo_group g ON g.id = t.source_thread_id
     WHERE ((t.created_at >= ? AND t.created_at < ?) OR (t.closed_at >= ? AND t.closed_at < ?)) AND ${taskScope.sql}
     ORDER BY at DESC LIMIT ?`,
    [period.from, period.to, period.from, period.to, ...taskScope.params, WORK_LIST_LIMIT]);
  return rows.map((row) => ({
    code: String(row.code ?? ""), title: String(row.title ?? ""), groupName: String(row.group_name ?? ""),
    personName: String(row.person_name ?? ""), status: TASK_STATUS_LABEL[Number(row.status)] ?? "", at: new Date(row.at),
  }));
}

/** Ticket chạm tới trong kỳ (tạo HOẶC đóng trong kỳ) — danh sách sheet phụ «Ticket». */
async function ticketRows(db: Db, ticketScope: { sql: string; params: unknown[] }, period: BriefPeriod): Promise<WorkReportRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.code, t.title, t.status, ${GROUP_NAME_SQL} AS group_name,
       COALESCE(NULLIF(t.handler_name, ''), t.requester_name) AS person_name, COALESCE(t.closed_at, t.created_at) AS at
     FROM ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id LEFT JOIN contact hc ON hc.id = t.handler_contact_id
     WHERE ((t.created_at >= ? AND t.created_at < ?) OR (t.closed_at >= ? AND t.closed_at < ?)) AND ${ticketScope.sql}
     ORDER BY at DESC LIMIT ?`,
    [period.from, period.to, period.from, period.to, ...ticketScope.params, WORK_LIST_LIMIT]);
  return rows.map((row) => ({
    code: String(row.code ?? ""), title: String(row.title ?? ""), groupName: String(row.group_name ?? ""),
    personName: String(row.person_name ?? ""), status: TICKET_STATUS_LABEL[Number(row.status)] ?? "", at: new Date(row.at),
  }));
}

/** Liên hệ có vai trò nhân sự (`contact.role ≠ None`) đã gửi tin trong phạm vi kỳ này — xem chốt 09/10/2026. */
export async function collectStaffStats(db: Db, scope: BriefScope, period: BriefPeriod, now: Date): Promise<StaffReportRow[]> {
  if (!scope.groupIds.length) return [];
  const [sentRows] = await db.query<RowDataPacket[]>(
    `SELECT sender_uid AS uid, COUNT(*) AS cnt FROM message
     WHERE group_id IN (?) AND sent_at >= ? AND sent_at < ? AND recalled_at IS NULL GROUP BY sender_uid`,
    [scope.groupIds, period.from, period.to]);
  if (!sentRows.length) return [];
  const uids = sentRows.map((row) => String(row.uid));
  const [staffRows] = await db.query<RowDataPacket[]>(
    `SELECT id, zalo_uid, COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM contact WHERE role <> 0 AND zalo_uid IN (?)`, [uids]);
  if (!staffRows.length) return [];
  const staffUids = staffRows.map((row) => String(row.zalo_uid));

  const [handledRows] = await db.query<RowDataPacket[]>(
    `SELECT handled_by_uid AS uid, COUNT(*) AS cnt FROM message_flag
     WHERE group_id IN (?) AND handled_by_uid IN (?) AND handled_at >= ? AND handled_at < ? GROUP BY handled_by_uid`,
    [scope.groupIds, staffUids, period.from, period.to]);
  // Việc của nhân viên vẫn phải áp luật phạm vi (nhóm theo dõi / Mật) — trước đây chỉ lọc assignee_uid nên việc trong
  // nhóm Mật người xem báo cáo không chọn lọt vào số liệu (review phase 8, H1). `t.assignee_uid = scope.uid` (phần của
  // `workScopeSql`) chỉ có tác dụng khi chính người XEM báo cáo cũng là nhân viên này — khớp chốt «việc của chính người
  // nhận vẫn hiện» mà không ảnh hưởng việc của NGƯỜI KHÁC.
  const workFilter = workScopeSql(scope, { thread: "t.source_thread_id", parties: ["t.assignee_uid"] });
  const [doneRows] = await db.query<RowDataPacket[]>(
    `SELECT assignee_uid AS uid, COUNT(*) AS cnt FROM task t
     WHERE status = ? AND assignee_uid IN (?) AND closed_at >= ? AND closed_at < ? AND ${workFilter.sql} GROUP BY assignee_uid`,
    [TaskStatus.Done, staffUids, period.from, period.to, ...workFilter.params]);
  const [overdueRows] = await db.query<RowDataPacket[]>(
    `SELECT assignee_uid AS uid, COUNT(*) AS cnt FROM task t
     WHERE status = ? AND assignee_uid IN (?) AND ${TASK_OVERDUE_AT_SQL} AND ${workFilter.sql} GROUP BY assignee_uid`,
    [TaskStatus.Open, staffUids, now, ...workFilter.params]);

  const sentByUid = new Map(sentRows.map((row) => [String(row.uid), Number(row.cnt)]));
  const handledByUid = new Map(handledRows.map((row) => [String(row.uid), Number(row.cnt)]));
  const doneByUid = new Map(doneRows.map((row) => [String(row.uid), Number(row.cnt)]));
  const overdueByUid = new Map(overdueRows.map((row) => [String(row.uid), Number(row.cnt)]));

  return staffRows
    .map((row): StaffReportRow => {
      const uid = String(row.zalo_uid);
      return {
        name: String(row.name ?? uid), messagesSent: sentByUid.get(uid) ?? 0, messagesHandled: handledByUid.get(uid) ?? 0,
        tasksDone: doneByUid.get(uid) ?? 0, tasksOverdue: overdueByUid.get(uid) ?? 0,
      };
    })
    .sort((a, b) => b.messagesSent - a.messagesSent);
}
