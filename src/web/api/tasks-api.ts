import type { RowDataPacket } from "mysql2";
import type { Principal } from "../../auth/principal.js";
import { ConversationType, TaskPriority, TaskSource, TaskStatus } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { formatDue, isTaskOverdue } from "../../tasks/task-format.js";
import { findTask, type TaskActor, type TaskParty, type TaskRow } from "../../tasks/task-repository.js";
import { parseDueArgument } from "../../tasks/task-due-parser.js";
import {
  addTaskNote, cancelTask, confirmTask, createTask, finishTask, reassignTask, rejectTask, reopenTask, rescheduleTask,
  TaskActionError, type TaskDeps, type TaskDue,
} from "../../tasks/task-service.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import type { ListSpec, Operator, SqlPart } from "./list-query.js";
import { runList } from "./list-runner.js";
import { parseVnDayStart } from "./message-search-api.js";
import { assertThreadVisible, scopedWhere } from "./scope.js";

// Màn Việc (phase 7 — N5): danh sách + chi tiết + tạo / thao tác việc trên web. MỘT chỗ cho mọi thao tác thật —
// src/tasks/task-service.ts — màn này chỉ gọi vào đó như lệnh Zalo / công cụ trợ lý, nên bot báo lại đúng như trên Zalo.

const NOTE_MAX = 2000;
const DAY_MS = 86_400_000;

// ===== Lọc danh sách =====

/** «Quá hạn»: đang làm + đã qua mốc hết hạn (giờ nếu có, hết ngày nếu chỉ có ngày) — khớp `isTaskOverdue`. */
const OVERDUE_SQL = "t.status = ? AND t.due_at IS NOT NULL AND IF(t.due_has_time = 1, t.due_at, t.due_at + INTERVAL 1 DAY) <= ?";
const MISSING_ASSIGNEE_SQL = "t.assignee_contact_id IS NULL AND (t.assignee_uid IS NULL OR t.assignee_uid = '') AND (t.assignee_name IS NULL OR t.assignee_name = '')";
const MISSING_DUE_SQL = "t.due_at IS NULL";

function isTruthyFilterValue(raw: string | undefined): boolean {
  return ["1", "true", "yes"].includes((raw ?? "").toLowerCase());
}

/** Điều kiện boolean không tham số (missing_assignee / missing_due) — chỉ nhận eq/ne, giá trị khác thì bỏ lọc (null). */
function buildFlagCondition(sql: string, operator: Operator, values: string[]): SqlPart | null {
  if (operator !== "eq" && operator !== "ne") return null;
  const truthy = isTruthyFilterValue(values[0]);
  const want = operator === "eq" ? truthy : !truthy;
  return { sql: want ? `(${sql})` : `NOT (${sql})`, params: [] };
}

/** «Quá hạn» cần so với GIỜ HIỆN TẠI + trạng thái Đang làm nên có tham số riêng, không dùng chung `buildFlagCondition`. */
function buildOverdueCondition(operator: Operator, values: string[]): SqlPart | null {
  if (operator !== "eq" && operator !== "ne") return null;
  const truthy = isTruthyFilterValue(values[0]);
  const want = operator === "eq" ? truthy : !truthy;
  const params = [TaskStatus.Open, new Date()];
  return { sql: want ? `(${OVERDUE_SQL})` : `NOT (${OVERDUE_SQL})`, params };
}

/**
 * Lọc «Hạn» theo NGÀY (giờ Việt Nam) trên cột DATETIME(3) — cùng khuôn với `buildSentAtCondition` của
 * `message-search-api.ts` (cột khác, logic giống), chỉ đổi cột sang `t.due_at`. Tái dùng `parseVnDayStart`
 * (hàm thuần, đã có sẵn) thay vì tự viết lại cách đọc ngày ô chọn.
 */
export function buildDueAtCondition(operator: Operator, values: string[]): SqlPart | null {
  const days = values.map(parseVnDayStart);
  const [first, second] = days;
  if (!first) return null;
  const next = (day: Date) => new Date(day.getTime() + DAY_MS);
  switch (operator) {
    case "eq": return { sql: "(t.due_at >= ? AND t.due_at < ?)", params: [first, next(first)] };
    case "ne": return { sql: "(t.due_at < ? OR t.due_at >= ?)", params: [first, next(first)] };
    case "gte": return { sql: "t.due_at >= ?", params: [first] };
    case "gt": return { sql: "t.due_at >= ?", params: [next(first)] };
    case "lte": return { sql: "t.due_at < ?", params: [next(first)] };
    case "lt": return { sql: "t.due_at < ?", params: [first] };
    case "between": return second ? { sql: "(t.due_at >= ? AND t.due_at < ?)", params: [first, next(second)] } : null;
    default: return null;
  }
}

export const TASK_LIST_SPEC: ListSpec = {
  fields: {
    status: { sql: "t.status", type: "number" },
    priority: { sql: "t.priority", type: "number" },
    assignee_contact_id: { sql: "t.assignee_contact_id", type: "number" },
    source_thread_id: { sql: "t.source_thread_id", type: "number" },
    source: { sql: "t.source", type: "number" },
    due_at: { type: "date", build: buildDueAtCondition },
    overdue: { type: "boolean", build: buildOverdueCondition },
    missing_assignee: { type: "boolean", build: (op, values) => buildFlagCondition(MISSING_ASSIGNEE_SQL, op, values) },
    missing_due: { type: "boolean", build: (op, values) => buildFlagCondition(MISSING_DUE_SQL, op, values) },
  },
  // NULL hết sau cùng dù sắp tăng hay giảm — khớp cách `task-repository.listTasks` xếp việc chưa có hạn ra cuối
  sorts: { due_at: "t.due_at IS NULL, t.due_at", status: "t.status", priority: "t.priority", code: "t.id", created_at: "t.created_at" },
  defaultSort: { by: "due_at", dir: "asc" },
  tieBreaker: "t.id",
  search: { param: "q", columns: ["t.code", "t.title", "t.assignee_name"] },
};

const TASK_FROM = "FROM task t LEFT JOIN zalo_group g ON g.id = t.source_thread_id";
const TASK_COLUMNS = `t.id, t.code, t.status, t.priority, t.title, t.assignee_contact_id, t.assignee_uid, t.assignee_name,
  t.assigner_contact_id, t.assigner_uid, t.assigner_name, t.source, t.source_thread_id, t.source_message_id, t.due_at, t.due_has_time,
  COALESCE(t.resolution, '') AS resolution, t.created_at, t.updated_at, t.confirmed_at, t.closed_at,
  g.thread_type AS source_thread_type, COALESCE(NULLIF(g.label, ''), g.name) AS source_thread_name`;

/** Trang trí một trang kết quả: ép kiểu số, cờ suy ra (quá hạn / thiếu người / thiếu hạn), tên nhóm nguồn. */
function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  const now = new Date();
  return rows.map((row) => {
    const dueAt = row.due_at ? new Date(row.due_at as string) : null;
    const dueHasTime = Boolean(Number(row.due_has_time));
    const status = Number(row.status) as TaskStatus;
    const hasAssignee = row.assignee_contact_id !== null || Boolean(row.assignee_uid) || String(row.assignee_name ?? "").trim() !== "";
    const inGroup = Number(row.source_thread_type) === ConversationType.Group;
    return {
      ...row,
      status, priority: Number(row.priority), source: Number(row.source),
      assignee_contact_id: row.assignee_contact_id === null ? null : Number(row.assignee_contact_id),
      source_thread_id: row.source_thread_id === null ? null : Number(row.source_thread_id),
      source_message_id: row.source_message_id === null ? null : Number(row.source_message_id),
      due_at: dueAt, due_has_time: dueHasTime,
      overdue: isTaskOverdue({ status, due_at: dueAt, due_has_time: dueHasTime }, now),
      missing_assignee: !hasAssignee,
      missing_due: dueAt === null,
      source_thread_name: row.source_thread_id ? (inGroup ? String(row.source_thread_name ?? "") || "(chưa rõ tên)" : "Tin riêng") : "",
    };
  });
}

/** Việc chưa lọc theo trạng thái (không gõ `status` lên URL) → chỉ hiện việc còn sống (đề xuất / đang làm). */
function buildTaskBaseWhere(principal: Principal, params: URLSearchParams): SqlPart | undefined {
  let base: SqlPart = { sql: "t.tenant_id = ?", params: [principal.tenantId] };
  if (!params.has("status")) {
    base = { sql: `(${base.sql}) AND t.status IN (?)`, params: [...base.params, [TaskStatus.Proposed, TaskStatus.Open]] };
  }
  return scopedWhere(principal, base, "t.source_thread_id");
}

async function getTaskDetail(db: Db, id: number, principal: Principal): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.id = ? AND t.tenant_id = ?`, [id, principal.tenantId]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "not_found", "Không có việc này");
  if (principal.groupIds !== null) {
    const threadId = row.source_thread_id === null ? null : Number(row.source_thread_id);
    if (threadId === null || !principal.groupIds.includes(threadId)) throw new ApiError(404, "not_found", "Không có việc này");
  }
  const [events] = await db.query<RowDataPacket[]>(
    "SELECT id, kind, actor_name, via, COALESCE(note, '') AS note, created_at FROM task_event WHERE task_id = ? ORDER BY id", [id]);
  return { ...decorate([row])[0], events: events.map((event) => ({ ...event, kind: Number(event.kind) })) };
}

/** Việc trong phạm vi nhóm của người này — dùng cho thao tác (cần đúng `TaskRow` của task-service). */
async function findTaskInScope(db: Db, id: number, principal: Principal): Promise<TaskRow | null> {
  const task = await findTask(db, id, principal.tenantId);
  if (!task) return null;
  if (principal.groupIds !== null && (task.source_thread_id === null || !principal.groupIds.includes(task.source_thread_id))) return null;
  return task;
}

function buildTaskDeps(service: { db: Db; jobs: { wake: () => void } }): TaskDeps {
  return { db: service.db, wakeJobs: () => service.jobs.wake() };
}

// ===== Input từ web =====

/** `due_date` 'YYYY-MM-DD' + `due_time` 'HH:mm' (cả hai tùy chọn) → mốc giờ VN. Tái dùng `parseDueArgument`
 *  (src/tasks/task-due-parser.ts) cho đúng luật «hạn chỉ ngày = 00:00 giờ VN» thay vì tự viết lại. */
export function parseTaskDueInput(rawDate: unknown, rawTime: unknown, now = new Date()): TaskDue | null {
  const dateStr = typeof rawDate === "string" ? rawDate.trim() : "";
  const timeStr = typeof rawTime === "string" ? rawTime.trim() : "";
  if (!dateStr) {
    if (timeStr) throw new ApiError(422, "validation_error", "Có giờ hạn mà chưa chọn ngày hạn");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new ApiError(422, "validation_error", "Ngày hạn không hợp lệ");
  if (timeStr && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) {
    throw new ApiError(422, "validation_error", "Giờ hạn không hợp lệ — dùng dạng HH:mm");
  }
  const parsed = parseDueArgument(timeStr ? `${dateStr}T${timeStr}:00` : dateStr, now);
  if (!parsed) throw new ApiError(422, "validation_error", "Hạn không hợp lệ");
  return parsed;
}

const TASK_PRIORITIES = new Set<number>([TaskPriority.High, TaskPriority.Normal, TaskPriority.Low]);

function parsePriority(raw: unknown): TaskPriority {
  if (raw === undefined || raw === null || raw === "") return TaskPriority.Normal;
  const value = Number(raw);
  if (!TASK_PRIORITIES.has(value)) throw new ApiError(422, "validation_error", "Mức ưu tiên không hợp lệ");
  return value as TaskPriority;
}

function parsePositiveInt(raw: unknown, message: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ApiError(422, "validation_error", message);
  return value;
}

/** Người trong Danh bạ → `TaskParty` (giữ mã Zalo để bot nhắn mà không cần nối bảng lúc thao tác). */
async function loadContactParty(db: Db, contactId: number): Promise<TaskParty> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT zalo_uid, COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM contact WHERE id = ?", [contactId]);
  const row = rows[0];
  if (!row) throw new ApiError(404, "not_found", "Không có người này trong Danh bạ");
  return { contactId, uid: row.zalo_uid ? String(row.zalo_uid) : null, name: String(row.name ?? "") };
}

async function assertThreadExists(db: Db, threadId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE id = ?", [threadId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có nhóm này");
}

/** Người giao trên web = người trong Danh bạ liên kết với tài khoản đang đăng nhập (nếu có) — để bot nhắn đúng người. */
async function resolveAssignerContactId(db: Db, principal: Principal): Promise<number | null> {
  if (!principal.userId) return null;
  const [rows] = await db.query<RowDataPacket[]>("SELECT contact_id FROM app_user WHERE id = ?", [principal.userId]);
  const value = rows[0]?.contact_id;
  return value === null || value === undefined ? null : Number(value);
}

const ACTIONS = new Set(["confirm", "reject", "done", "reopen", "cancel", "note", "reschedule", "reassign"]);
const ACTION_LABELS: Record<string, string> = {
  confirm: "Xác nhận", reject: "Bỏ đề xuất", done: "Báo xong", reopen: "Mở lại", cancel: "Hủy", note: "Ghi chú",
  reschedule: "Dời hạn", reassign: "Giao lại",
};

export const taskRoutes: ApiRoute[] = [
  ["GET", /^\/api\/tasks$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, TASK_LIST_SPEC, {
    select: TASK_COLUMNS, from: TASK_FROM, baseWhere: buildTaskBaseWhere(principal, url.searchParams), decorate,
  }))],

  ["GET", /^\/api\/tasks\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, await getTaskDetail(service.db, parseId(match[1]), principal))],

  // Tạo việc trên web (quản trị + quản lý) — assigner = người trong Danh bạ liên kết tài khoản đang đăng nhập (nếu có)
  ["POST", /^\/api\/tasks$/, async ({ request, response, service, principal }) => {
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title : "";
    const priority = parsePriority(body.priority);
    const due = parseTaskDueInput(body.due_date, body.due_time);

    let assignee: TaskParty | null = null;
    if (body.assignee_contact_id !== undefined && body.assignee_contact_id !== null && body.assignee_contact_id !== "") {
      assignee = await loadContactParty(service.db, parsePositiveInt(body.assignee_contact_id, "Người phụ trách không hợp lệ"));
    }
    let sourceThreadId: number | null = null;
    if (body.source_thread_id !== undefined && body.source_thread_id !== null && body.source_thread_id !== "") {
      sourceThreadId = parsePositiveInt(body.source_thread_id, "Nhóm không hợp lệ");
      await assertThreadExists(service.db, sourceThreadId);
      assertThreadVisible(principal, sourceThreadId);
    }
    const assignerContactId = await resolveAssignerContactId(service.db, principal);
    const deps = buildTaskDeps(service);
    let task: TaskRow | null;
    try {
      task = await createTask(deps, {
        title, priority, assignee, source: TaskSource.Web, sourceThreadId, due, via: "web",
        assigner: { contactId: assignerContactId, uid: null, name: principal.fullName || principal.email || "Quản trị" },
      });
    } catch (error) {
      if (error instanceof TaskActionError) throw new ApiError(422, "validation_error", error.message);
      throw error;
    }
    if (!task) throw new ApiError(409, "duplicate", "Việc này đã có rồi");
    await recordAudit(service.db, { entity: "task", entityId: task.id, action: "create", message: `Tạo việc ${task.code}: ${task.title}` });
    sendOk(response, await getTaskDetail(service.db, task.id, principal), "Đã tạo việc", 201);
  }],

  // Thao tác trên web: { action, note?, due_date?, due_time?, assignee_contact_id? } — actor = người dùng web, bot báo
  // qua Zalo đúng như lệnh gõ (src/tasks/task-service.ts); TaskActionError (chuyển trạng thái sai) → 409.
  ["POST", /^\/api\/tasks\/(\d+)\/actions$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    const body = await readJson(request);
    const action = String(body.action ?? "");
    if (!ACTIONS.has(action)) throw new ApiError(422, "validation_error", "Thao tác không hợp lệ");
    const rawNote = typeof body.note === "string" ? body.note.trim() : "";
    if (rawNote.length > NOTE_MAX) throw new ApiError(422, "validation_error", `Ghi chú tối đa ${NOTE_MAX} ký tự`);
    if (action === "note" && !rawNote) throw new ApiError(422, "validation_error", "Chưa có nội dung ghi chú");
    const note = rawNote.slice(0, NOTE_MAX);

    const task = await findTaskInScope(service.db, id, principal);
    if (!task) throw new ApiError(404, "not_found", "Không có việc này");

    const actor: TaskActor = { contactId: null, uid: null, name: principal.fullName || principal.email || "Quản trị", via: "web" };
    const deps = buildTaskDeps(service);
    let message = `${ACTION_LABELS[action]} ${task.code}`;
    try {
      if (action === "confirm") await confirmTask(deps, task, actor);
      else if (action === "reject") await rejectTask(deps, task, actor, false);
      else if (action === "done") await finishTask(deps, task, actor, note);
      else if (action === "reopen") await reopenTask(deps, task, actor, note);
      else if (action === "cancel") await cancelTask(deps, task, actor, note);
      else if (action === "note") await addTaskNote(deps, task, actor, note);
      else if (action === "reschedule") {
        const due = parseTaskDueInput(body.due_date, body.due_time);
        if (!due) throw new ApiError(422, "validation_error", "Chưa chọn hạn mới");
        const updated = await rescheduleTask(deps, task, actor, due, note);
        message = `Dời hạn ${task.code} → ${formatDue(updated.due_at, updated.due_has_time)}`;
      } else if (action === "reassign") {
        const party = await loadContactParty(service.db, parsePositiveInt(body.assignee_contact_id, "Chưa chọn người phụ trách mới"));
        await reassignTask(deps, task, actor, party);
        message = `Giao lại ${task.code} cho ${party.name}`;
      }
    } catch (error) {
      if (error instanceof TaskActionError) throw new ApiError(409, "invalid_state", error.message);
      throw error;
    }
    if (note && action !== "reschedule" && action !== "reassign") message += `: ${note}`;
    await recordAudit(service.db, { entity: "task", entityId: id, action: "update", message });
    sendOk(response, await getTaskDetail(service.db, id, principal), `${ACTION_LABELS[action]} — đã báo qua Zalo`);
  }],
];
