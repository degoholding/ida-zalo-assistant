// Dữ liệu dựng chung cho bài kiểm tích hợp phase 8 (bản tin + báo cáo) — đúng nhân vật / nhóm thử ở mục 0 của
// doc/08-kich-ban-test-phase-8.md để đọc test đối chiếu được với kịch bản test tay:
//   Chị Mi    — người nhận «mọi nhóm», 07:30 / 17:30
//   Anh Phong — người nhận chọn G1 + G3 (Mật), 07:45 / 17:15
//   Chị Hằng  — người nhận chọn G1, giờ trống cả hai (tắt bản tin)
//   Anh Tuấn  — Quản lý, KHÔNG là người nhận · Huy, Tâm — nhân sự chưa vai trò · Anh Sáu — khách hàng
//   G1 «TEST Sales Miền Tây» nội bộ · G2 «TEST ĐL Thành Công» khách hàng · G3 «TEST BGĐ Công nợ» nội bộ, Mật
// Tệp không có đuôi .test.ts nên `npm test` không chạy riêng nó.

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { AppConfig } from "../src/config.js";
import { DEFAULT_IMPORTANT_KEYWORDS, DEFAULT_STRICT_KEYWORDS, DEFAULT_URGENT_KEYWORDS } from "../src/config.js";
import { ContactRole, GroupKind, MessagePriority, ReplyState, TaskSource, TaskStatus, TicketStatus } from "../src/constants.js";
import { createPool, type Db } from "../src/db/pool.js";
import { buildWorkCalendar, type WorkCalendar } from "../src/schedule/work-calendar.js";
import { directKey, ensureGroup, ensureThread } from "../src/sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";

export const databaseUrl = process.env.TEST_DATABASE_URL;

const TABLES = ["brief_log", "job", "task_event", "task", "ticket_event", "ticket_attachment", "ticket", "system_ai_usage",
  "alert_log", "alert_cursor", "message_reaction", "message_flag", "message_search", "assistant_turn", "recipient_vip",
  "recipient_group", "recipient", "attachment", "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account", "audit_log"];

const WORK_HOURS = "08:30-12:00, 13:30-17:30";
const QUIET_HOURS = "21:00-06:30";

/** «2026-10-12 07:30» giờ Việt Nam → Date. */
export function vn(text: string): Date {
  return new Date(`${text.replace(" ", "T")}:00+07:00`);
}

/** Lịch làm việc mục 0: T2–T7, 08:30–12:00 + 13:30–17:30, yên lặng 21:00–06:30. */
export function makeCalendar(holidays = ""): WorkCalendar {
  return buildWorkCalendar({ workHours: WORK_HOURS, workDays: [1, 2, 3, 4, 5, 6], quietHours: QUIET_HOURS, holidays });
}

export function makeConfig(): AppConfig {
  return {
    sessionEncryptionKey: "0".repeat(64),
    assistant: { dailyTokenCap: 1_000_000 },
    privacy: { allowedAiProviders: ["1", "2", "3", "4", "5", "6"] },
    calendar: { workHours: WORK_HOURS, workDays: ["1", "2", "3", "4", "5", "6"], quietHours: QUIET_HOURS, holidays: "" },
    alerts: {
      enabled: true, urgentKeywords: DEFAULT_URGENT_KEYWORDS, importantKeywords: DEFAULT_IMPORTANT_KEYWORDS, strictKeywords: DEFAULT_STRICT_KEYWORDS,
      replyWaitMinutes: 120, vipWaitMinutes: 30, dailyReminderCap: 3, urgentMergeSeconds: 120, aiEnabled: false, telegramBotToken: "", telegramChatId: "",
    },
    briefs: { aiHighlightsEnabled: true, periodicReportsEnabled: true },
  } as unknown as AppConfig;
}

export interface Phase8World {
  botId: number;
  g1: number;
  g2: number;
  g3: number;
  mi: number;
  phong: number;
  hang: number;
  /** Cuộc riêng giữa bot và Huy — nơi Huy «báo lỗi: …» tạo ticket (N-13). */
  huyDirect: number;
}

/**
 * Pool mà đồng hồ MySQL (CURRENT_TIMESTAMP của `brief_log.created_at`) đứng yên tại `at` — để mốc giả của bài kiểm khớp
 * giờ CSDL như máy thật (luật «dòng Composing kẹt quá 15 phút» so `now` với `created_at`). Nhớ `end()` sau khi dùng.
 */
export function createPinnedPool(at: Date): Db {
  const pool = createPool(databaseUrl!);
  pool.pool.on("connection", (connection) => {
    connection.query(`SET TIMESTAMP = ${at.getTime() / 1000}`, (error) => { if (error) throw error; });
  });
  return pool;
}

export async function resetTables(db: Db): Promise<void> {
  await db.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
  await db.query("SET FOREIGN_KEY_CHECKS = 1");
}

const READ = { readMessages: true, captureFiles: false };

async function makeGroup(db: Db, zaloId: string, name: string, kind: GroupKind, confidential: boolean): Promise<number> {
  const id = (await ensureGroup(db, zaloId, READ)).group.id;
  await db.query("UPDATE zalo_group SET name = ?, group_kind = ?, is_confidential = ? WHERE id = ?", [name, kind, confidential ? 1 : 0, id]);
  return id;
}

async function makeRecipient(db: Db, uid: string, name: string, rank: number, allGroups: boolean, morning: string, evening: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO recipient (contact_id, name, rank_order, all_groups, morning_brief_at, evening_brief_at) VALUES (?, ?, ?, ?, ?, ?)",
    [rows[0].id, name, rank, allGroups ? 1 : 0, morning, evening]);
  return result.insertId;
}

/** Dựng toàn bộ nhân vật + nhóm + người nhận của mục 0. */
export async function seedWorld(db: Db): Promise<Phase8World> {
  const [bot] = await db.query<ResultSetHeader>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
  const g1 = await makeGroup(db, "g1", "TEST Sales Miền Tây", GroupKind.Internal, false);
  const g2 = await makeGroup(db, "g2", "TEST ĐL Thành Công", GroupKind.Customer, false);
  const g3 = await makeGroup(db, "g3", "TEST BGĐ Công nợ", GroupKind.Internal, true);
  await db.query(`INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES
    ('u-mi', 'Chị Mi', 2, ${ContactRole.Manager}), ('u-phong', 'Anh Phong', 2, ${ContactRole.Manager}),
    ('u-hang', 'Chị Hằng', 2, ${ContactRole.None}), ('u-tuan', 'Anh Tuấn', 2, ${ContactRole.Manager}),
    ('u-huy', 'Huy', 2, ${ContactRole.None}), ('u-tam', 'Tâm', 2, ${ContactRole.None}), ('u-sau', 'Anh Sáu', 1, ${ContactRole.None})`);
  const mi = await makeRecipient(db, "u-mi", "Chị Mi", 1, true, "07:30", "17:30");
  const phong = await makeRecipient(db, "u-phong", "Anh Phong", 2, false, "07:45", "17:15");
  const hang = await makeRecipient(db, "u-hang", "Chị Hằng", 3, false, "", "");
  await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES (?, ?), (?, ?), (?, ?)", [phong, g1, phong, g3, hang, g1]);
  const huyDirect = (await ensureThread(db, directKey(bot.insertId, "u-huy"), READ, "Huy")).group.id;
  return { botId: bot.insertId, g1, g2, g3, mi, phong, hang, huyDirect };
}

let msgSeq = 0;

/** Tin vào nhóm qua đúng đường đồng bộ thật (`ingestGroupMessage`); trả id tin trong CSDL. */
export async function postMessage(
  db: Db, zaloGroupId: string, senderUid: string, senderName: string, text: string, at: Date, extra: Partial<IncomingGroupMessage> = {},
): Promise<number> {
  msgSeq += 1;
  const incoming: IncomingGroupMessage = {
    zaloGroupId, msgId: `p8-${Date.now()}-${msgSeq}`, cliMsgId: "", msgType: "webchat", senderUid, senderName,
    sentAtMs: at.getTime(), content: text, quote: null, mentions: null, ...extra,
  };
  await ingestGroupMessage({ db, defaults: READ }, 1, incoming);
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE zalo_msg_id = ?", [incoming.msgId]);
  return Number(rows[0].id);
}

export interface FlagOptions {
  priority?: MessagePriority;
  replyState?: ReplyState;
  dueAt?: Date | null;
  handledAt?: Date | null;
  forUid?: string | null;
  pendingAi?: boolean;
}

/** Gắn cờ cho một tin như bộ phân loại phase 5 đã làm (KHẨN / chờ trả lời / đã xử lý…). */
export async function flagMessage(db: Db, messageId: number, options: FlagOptions): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT group_id FROM message WHERE id = ?", [messageId]);
  await db.query(
    `INSERT INTO message_flag (message_id, group_id, priority, reply_state, due_at, handled_at, for_uid, pending_ai)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [messageId, rows[0].group_id, options.priority ?? MessagePriority.Normal, options.replyState ?? ReplyState.NotNeeded,
      options.dueAt ?? null, options.handledAt ?? null, options.forUid ?? null, options.pendingAi ? 1 : 0]);
}

export interface TaskInput {
  title: string;
  assigneeUid: string;
  assigneeName: string;
  assignerUid?: string;
  threadId: number | null;
  dueAt: Date | null;
  dueHasTime?: boolean;
  status?: TaskStatus;
  closedAt?: Date | null;
  createdAt: Date;
}

export async function createTask(db: Db, input: TaskInput): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO task (code, status, title, assignee_uid, assignee_name, assigner_uid, assigner_name, source, source_thread_id,
       due_at, due_has_time, created_at, closed_at)
     VALUES ('', ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    [input.status ?? TaskStatus.Open, input.title, input.assigneeUid, input.assigneeName, input.assignerUid ?? "u-tuan",
      TaskSource.Command, input.threadId, input.dueAt, input.dueHasTime ? 1 : 0, input.createdAt, input.closedAt ?? null]);
  await db.query("UPDATE task SET code = CONCAT('V-', id) WHERE id = ?", [result.insertId]);
  return result.insertId;
}

export async function createTicket(
  db: Db, input: { title: string; requesterUid: string; requesterName: string; threadId: number | null; createdAt: Date; status?: TicketStatus },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO ticket (code, status, title, requester_uid, requester_name, source_thread_id, created_at) VALUES ('', ?, ?, ?, ?, ?, ?)",
    [input.status ?? TicketStatus.New, input.title, input.requesterUid, input.requesterName, input.threadId, input.createdAt]);
  await db.query("UPDATE ticket SET code = CONCAT('T-', id) WHERE id = ?", [result.insertId]);
  return result.insertId;
}

export interface BriefLogRow {
  id: number;
  recipient_id: number;
  kind: number;
  trigger_source: number;
  period_key: string;
  period_label: string;
  status: number;
  body: string | null;
  files: unknown;
  ai_note: string;
  error: string;
}

export async function briefLogs(db: Db): Promise<BriefLogRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM brief_log ORDER BY id");
  return rows.map((row) => ({ ...row, recipient_id: Number(row.recipient_id), kind: Number(row.kind),
    trigger_source: Number(row.trigger_source), status: Number(row.status) })) as BriefLogRow[];
}

/** Payload các job gửi tin riêng cho người nhận, theo thứ tự xếp hàng. */
export async function recipientJobs(db: Db): Promise<{ id: number; status: number; payload: Record<string, any> }[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, status, payload FROM job WHERE kind = 3 ORDER BY id");
  return rows.map((row) => ({
    id: Number(row.id), status: Number(row.status),
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  }));
}
