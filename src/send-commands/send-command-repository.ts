import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { SendActionKind, SendCommandSource, SendCommandStatus, SendTargetStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { DraftInput, ReminderRepeat, SendCommandRow, SendTargetRow } from "./send-command-types.js";

// Truy vấn hai bảng `send_command` + `send_command_target` (migration 028). Chỉ đọc / ghi dữ liệu — luật quyền ở
// send-command-permissions.ts, giới hạn ở send-command-limits.ts. Mọi câu đọc nhiều dòng đều có LIMIT.

const LIST_LIMIT = 50;

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseIds(value: unknown): number[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
}

function toCommand(row: RowDataPacket): SendCommandRow {
  return {
    id: Number(row.id), tenantId: Number(row.tenant_id), source: Number(row.source), status: Number(row.status),
    requesterContactId: toNumberOrNull(row.requester_contact_id), requesterUid: row.requester_uid,
    requesterName: row.requester_name, createdByUserId: toNumberOrNull(row.created_by_user_id),
    botAccountId: toNumberOrNull(row.bot_account_id), sourceThreadId: toNumberOrNull(row.source_thread_id),
    sourceMessageId: toNumberOrNull(row.source_message_id), body: row.body, attachmentIds: parseIds(row.attachment_ids),
    scheduledAt: row.scheduled_at, actionKind: Number(row.action_kind), reminderAt: row.reminder_at,
    reminderRepeat: Number(row.reminder_repeat) as ReminderRepeat, offHoursNote: row.off_hours_note, confirmExpiresAt: row.confirm_expires_at,
    confirmedAt: row.confirmed_at, cancelledAt: row.cancelled_at, cancelledBy: row.cancelled_by,
    reportedAt: row.reported_at, createdAt: row.created_at,
  };
}

function toTarget(row: RowDataPacket): SendTargetRow {
  return {
    id: Number(row.id), commandId: Number(row.command_id), kind: Number(row.target_kind), key: row.target_key,
    threadId: toNumberOrNull(row.thread_id), zaloUid: row.zalo_uid, displayName: row.display_name,
    status: Number(row.status), attemptNo: Number(row.attempt_no), jobId: toNumberOrNull(row.job_id),
    error: row.error, sentAt: row.sent_at,
  };
}

/** Ghi lệnh + các nơi nhận trong MỘT transaction; trả mã lệnh (hiển thị «G-<id>»). */
export async function insertDraft(db: Db, input: DraftInput): Promise<number> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO send_command (tenant_id, source, status, requester_contact_id, requester_uid, requester_name,
         created_by_user_id, bot_account_id, source_thread_id, source_message_id, body, attachment_ids, scheduled_at,
         off_hours_note, confirm_expires_at, action_kind, reminder_at, reminder_repeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.tenantId ?? 1, input.source, input.status ?? SendCommandStatus.Draft, input.requesterContactId ?? null,
       input.requesterUid ?? "", (input.requesterName ?? "").slice(0, 255), input.createdByUserId ?? null,
       input.botAccountId ?? null, input.sourceThreadId ?? null, input.sourceMessageId ?? null, input.body,
       input.attachmentIds?.length ? JSON.stringify(input.attachmentIds) : null, input.scheduledAt ?? null,
       (input.offHoursNote ?? "").slice(0, 200), input.confirmExpiresAt ?? null, input.actionKind ?? SendActionKind.Message,
       input.reminderAt ?? null, input.reminderRepeat ?? 0]);
    for (const target of input.targets) {
      await connection.query(
        `INSERT INTO send_command_target (command_id, target_kind, target_key, thread_id, zalo_uid, display_name, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, target.kind, target.key, target.threadId, target.zaloUid,
         target.displayName.slice(0, 255), SendTargetStatus.Pending]);
    }
    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function findCommand(db: Db, id: number): Promise<SendCommandRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM send_command WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? toCommand(rows[0]) : null;
}

export async function listTargets(db: Db, commandId: number): Promise<SendTargetRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM send_command_target WHERE command_id = ? ORDER BY id LIMIT 100", [commandId]);
  return rows.map(toTarget);
}

export async function findTarget(db: Db, id: number): Promise<SendTargetRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM send_command_target WHERE id = ? LIMIT 1", [id]);
  return rows[0] ? toTarget(rows[0]) : null;
}

/**
 * Giành quyền xác nhận: Draft còn hạn → `nextStatus` (Scheduled nếu có giờ hẹn, ngược lại Sending). true = chính lời gọi
 * này thắng (chỉ khi đó mới được xếp job) — «đồng ý» hai lần / song song thì chỉ một bên được true.
 */
export async function claimConfirm(db: Db, id: number, now: Date, nextStatus: SendCommandStatus): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE send_command SET status = ?, confirmed_at = ?
     WHERE id = ? AND status = ? AND confirm_expires_at > ?`,
    [nextStatus, now, id, SendCommandStatus.Draft, now]);
  return result.affectedRows === 1;
}

/** Đánh Expired mọi nháp quá hạn xác nhận; trả số dòng đổi. */
export async function expireStaleDrafts(db: Db, now: Date): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE send_command SET status = ? WHERE status = ? AND confirm_expires_at <= ?",
    [SendCommandStatus.Expired, SendCommandStatus.Draft, now]);
  return result.affectedRows;
}

export async function setCommandStatus(db: Db, id: number, status: SendCommandStatus): Promise<void> {
  await db.query("UPDATE send_command SET status = ? WHERE id = ?", [status, id]);
}

export async function markReported(db: Db, id: number, now: Date): Promise<void> {
  await db.query("UPDATE send_command SET reported_at = ? WHERE id = ? AND reported_at IS NULL", [now, id]);
}

/** Hủy lệnh Draft / Scheduled (kèm các nơi chưa gửi). false = lệnh không còn ở trạng thái hủy được. */
export async function cancelCommand(db: Db, id: number, cancelledBy: string, now: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE send_command SET status = ?, cancelled_at = ?, cancelled_by = ?
     WHERE id = ? AND status IN (?, ?)`,
    [SendCommandStatus.Cancelled, now, cancelledBy.slice(0, 100), id, SendCommandStatus.Draft, SendCommandStatus.Scheduled]);
  if (result.affectedRows !== 1) return false;
  await db.query(
    "UPDATE send_command_target SET status = ? WHERE command_id = ? AND status IN (?, ?)",
    [SendTargetStatus.Cancelled, id, SendTargetStatus.Pending, SendTargetStatus.Queued]);
  return true;
}

export async function markTarget(db: Db, id: number, status: SendTargetStatus, error = ""): Promise<void> {
  await db.query(
    "UPDATE send_command_target SET status = ?, error = ?, sent_at = IF(? = ?, CURRENT_TIMESTAMP(3), sent_at) WHERE id = ?",
    [status, error.slice(0, 500), status, SendTargetStatus.Sent, id]);
}

/**
 * Mở một lượt gửi mới cho nơi nhận (lần đầu hoặc gửi lại): chỉ nơi Pending / Failed, `attempt_no` + 1. Trả số lượt mới
 * (dùng trong dedupeKey `sendcmd:t<id>:a<lượt>`), null = nơi nhận không ở trạng thái mở lượt được.
 */
export async function beginTargetAttempt(db: Db, id: number): Promise<number | null> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE send_command_target SET attempt_no = attempt_no + 1, status = ?, error = ''
     WHERE id = ? AND status IN (?, ?)`,
    [SendTargetStatus.Queued, id, SendTargetStatus.Pending, SendTargetStatus.Failed]);
  if (result.affectedRows !== 1) return null;
  const target = await findTarget(db, id);
  return target ? target.attemptNo : null;
}

export async function setTargetJob(db: Db, id: number, jobId: number | null): Promise<void> {
  await db.query("UPDATE send_command_target SET job_id = ? WHERE id = ?", [jobId, id]);
}

/** Đếm lệnh Zalo của một người từ `since`: `draft` = mọi lệnh đã dựng nháp, `confirmed` = lệnh đã bấm «đồng ý». */
export async function countRecent(db: Db, uid: string, kind: "draft" | "confirmed", since: Date): Promise<number> {
  const column = kind === "draft" ? "created_at" : "confirmed_at";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM send_command WHERE requester_uid = ? AND source = ? AND ${column} >= ?`,
    [uid, SendCommandSource.Zalo, since]);
  return Number(rows[0]?.n ?? 0);
}

/** Lệnh đang hẹn giờ của một người (mới hẹn trước) — câu «lệnh gửi». */
export async function listScheduledByRequester(db: Db, uid: string): Promise<SendCommandRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM send_command WHERE requester_uid = ? AND source = ? AND status = ?
     ORDER BY scheduled_at LIMIT ${LIST_LIMIT}`,
    [uid, SendCommandSource.Zalo, SendCommandStatus.Scheduled]);
  return rows.map(toCommand);
}

export async function listRecentByRequester(db: Db, uid: string, limit = 10): Promise<SendCommandRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM send_command WHERE requester_uid = ? AND source = ? ORDER BY id DESC LIMIT ?",
    [uid, SendCommandSource.Zalo, Math.min(Math.max(1, limit), LIST_LIMIT)]);
  return rows.map(toCommand);
}
