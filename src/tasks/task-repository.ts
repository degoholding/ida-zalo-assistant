import type { RowDataPacket } from "mysql2";
import { TaskEventKind, TaskPriority, TaskRemindStage, TaskSource, TaskStatus } from "../constants.js";
import type { Db } from "../db/pool.js";

// Đọc / ghi bảng task + task_event (migration 024). Thao tác có báo tin nằm ở task-service.ts.

/** Một người trên Zalo gắn với việc (người phụ trách / người giao). uid null = chỉ có tên (vd người giao làm trên web). */
export interface TaskParty {
  contactId: number | null;
  uid: string | null;
  name: string;
}

/** Ai đang thao tác — để ghi nhật ký và không báo lại chính người đó. */
export interface TaskActor extends TaskParty {
  via: "zalo" | "web" | "system";
}

export interface TaskRow {
  id: number;
  code: string;
  status: TaskStatus;
  priority: TaskPriority;
  title: string;
  assignee: TaskParty | null;
  assigner: TaskParty;
  source: TaskSource;
  source_thread_id: number | null;
  source_message_id: number | null;
  due_at: Date | null;
  due_has_time: boolean;
  remind_stage: TaskRemindStage;
  resolution: string;
  created_at: Date;
}

export const formatTaskCode = (id: number) => `V-${String(id).padStart(4, "0")}`;
/** Mã ngắn dùng trong tin Zalo («V-12») — lệnh nhận cả «V-0012». */
export const shortTaskCode = (task: Pick<TaskRow, "id">) => `V-${task.id}`;

export const TASK_COLUMNS = `t.id, t.code, t.status, t.priority, t.title, t.assignee_contact_id, t.assignee_uid, t.assignee_name,
  t.assigner_contact_id, t.assigner_uid, t.assigner_name, t.source, t.source_thread_id, t.source_message_id, t.due_at,
  t.due_has_time, t.remind_stage, COALESCE(t.resolution, '') AS resolution, t.created_at`;

const toId = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const toUid = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

export function toTask(row: RowDataPacket): TaskRow {
  const hasAssignee = row.assignee_contact_id !== null || toUid(row.assignee_uid) !== null || String(row.assignee_name ?? "") !== "";
  return {
    id: Number(row.id), code: String(row.code), status: Number(row.status) as TaskStatus, priority: Number(row.priority) as TaskPriority,
    title: String(row.title ?? ""),
    assignee: hasAssignee ? { contactId: toId(row.assignee_contact_id), uid: toUid(row.assignee_uid), name: String(row.assignee_name ?? "") } : null,
    assigner: { contactId: toId(row.assigner_contact_id), uid: toUid(row.assigner_uid), name: String(row.assigner_name ?? "") },
    source: Number(row.source) as TaskSource, source_thread_id: toId(row.source_thread_id), source_message_id: toId(row.source_message_id),
    due_at: row.due_at ? new Date(row.due_at) : null, due_has_time: Boolean(Number(row.due_has_time)),
    remind_stage: Number(row.remind_stage) as TaskRemindStage, resolution: String(row.resolution ?? ""), created_at: new Date(row.created_at),
  };
}

export async function findTask(db: Db, id: number, tenantId = 1): Promise<TaskRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TASK_COLUMNS} FROM task t WHERE t.id = ? AND t.tenant_id = ?`, [id, tenantId]);
  return rows[0] ? toTask(rows[0]) : null;
}

export interface TaskListFilter {
  statuses: TaskStatus[];
  /** Người này là người phụ trách HOẶC người giao */
  involvingUid?: string;
  /** Chỉ việc giao trong cuộc này (hỏi trong nhóm = việc của nhóm đó) */
  threadId?: number;
  /** Chỉ việc đã quá hạn tại mốc này */
  overdueAt?: Date;
  limit?: number;
}

/** Việc theo bộ lọc — có hạn gần nhất trước, việc chưa có hạn sau cùng. */
export async function listTasks(db: Db, filter: TaskListFilter, tenantId = 1): Promise<TaskRow[]> {
  const where = ["t.tenant_id = ?", "t.status IN (?)"];
  const params: unknown[] = [tenantId, filter.statuses];
  if (filter.involvingUid) {
    where.push("(t.assignee_uid = ? OR t.assigner_uid = ?)");
    params.push(filter.involvingUid, filter.involvingUid);
  }
  if (filter.threadId) {
    where.push("t.source_thread_id = ?");
    params.push(filter.threadId);
  }
  if (filter.overdueAt) {
    // Hạn chỉ có ngày: quá hạn khi hết ngày đó (lưu 00:00 giờ VN) — so với đầu ngày SAU
    where.push("t.due_at IS NOT NULL AND IF(t.due_has_time = 1, t.due_at, t.due_at + INTERVAL 1 DAY) <= ?");
    params.push(filter.overdueAt);
  }
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TASK_COLUMNS} FROM task t WHERE ${where.join(" AND ")} ORDER BY t.due_at IS NULL, t.due_at, t.id LIMIT ?`,
    [...params, filter.limit ?? 30]);
  return rows.map(toTask);
}

export async function recordTaskEvent(db: Db, taskId: number, kind: TaskEventKind, actor: Pick<TaskActor, "name" | "via">, note = ""): Promise<void> {
  await db.query("INSERT INTO task_event (task_id, kind, actor_name, via, note) VALUES (?, ?, ?, ?, ?)",
    [taskId, kind, actor.name.slice(0, 255), actor.via, note || null]);
}
