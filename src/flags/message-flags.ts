import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { FlagSource, MessagePriority, ReplyState } from "../constants.js";
import type { Db } from "../db/pool.js";

// Cờ trên từng tin (bảng message_flag, migration 017) + cảm xúc thả lên tin (message_reaction). Phase 3 dựng chỗ chứa và
// các hàm đọc / ghi; phase 5 (check tin, N1) dùng để phân loại KHẨN / QUAN TRỌNG, đếm giờ chờ, báo người nhận.
// Luật «đã xử lý» theo IDA câu 8: trả lời trích dẫn / nhắc tên người hỏi / đánh dấu tay = đã xử lý; thả cảm xúc = đã xem.

export interface FlagInput {
  messageId: number;
  groupId: number;
  priority: MessagePriority;
  replyState: ReplyState;
  source: FlagSource;
  reason: string;
  dueAt?: Date | null;
}

export interface FlagRow {
  message_id: number;
  group_id: number;
  priority: MessagePriority;
  reply_state: ReplyState;
  source: FlagSource;
  reason: string;
  due_at: Date | null;
  seen_at: Date | null;
  handled_at: Date | null;
}

/**
 * Gắn / cập nhật cờ. Gắn lại chỉ NÂNG mức ưu tiên (tin đã KHẨN không bị hạ xuống QUAN TRỌNG vì một lần phân loại sau);
 * tin đã xử lý thì giữ nguyên trạng thái xử lý.
 */
export async function upsertMessageFlag(db: Db, flag: FlagInput): Promise<void> {
  await db.query(
    `INSERT INTO message_flag (message_id, group_id, priority, reply_state, source, reason, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source = IF(VALUES(priority) > priority, VALUES(source), source),
       reason = IF(VALUES(priority) > priority, VALUES(reason), reason),
       priority = GREATEST(priority, VALUES(priority)),
       reply_state = IF(reply_state = ${ReplyState.Handled}, reply_state, GREATEST(reply_state, VALUES(reply_state))),
       due_at = COALESCE(due_at, VALUES(due_at))`,
    [flag.messageId, flag.groupId, flag.priority, flag.replyState, flag.source, flag.reason.slice(0, 300), flag.dueAt ?? null],
  );
}

/** Có người thả cảm xúc lên tin đang chờ trả lời → «đã xem» (vẫn nhắc, IDA câu 8). */
export async function markFlagSeen(db: Db, messageId: number, byUid: string, at: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE message_flag SET reply_state = ?, seen_at = ?, seen_by_uid = ? WHERE message_id = ? AND reply_state = ?",
    [ReplyState.Seen, at, byUid.slice(0, 40), messageId, ReplyState.Waiting]);
  return result.affectedRows === 1;
}

/** Tin đã được xử lý: bằng một tin trả lời (`replyMessageId`) hoặc đánh dấu tay (null). */
export async function markFlagHandled(db: Db, messageId: number, byUid: string, replyMessageId: number | null, at: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE message_flag SET reply_state = ?, handled_at = ?, handled_by_uid = ?, handled_message_id = ?
     WHERE message_id = ? AND reply_state IN (?, ?)`,
    [ReplyState.Handled, at, byUid.slice(0, 40), replyMessageId, messageId, ReplyState.Waiting, ReplyState.Seen]);
  return result.affectedRows === 1;
}

/** Tin còn chờ (chưa xử lý), KHẨN trước, cũ trước. `groupIds` rỗng = mọi nhóm. */
export async function listOpenFlags(db: Db, options: { groupIds?: number[]; limit?: number } = {}): Promise<FlagRow[]> {
  const groupFilter = options.groupIds?.length ? "AND group_id IN (?)" : "";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT message_id, group_id, priority, reply_state, source, reason, due_at, seen_at, handled_at FROM message_flag
     WHERE reply_state IN (?, ?) ${groupFilter}
     ORDER BY priority DESC, created_at LIMIT ?`,
    [ReplyState.Waiting, ReplyState.Seen, ...(options.groupIds?.length ? [options.groupIds] : []), options.limit ?? 100]);
  return rows as FlagRow[];
}

/** Tin chờ đã quá hạn nhắc (due_at) tại mốc `now`. */
export async function listOverdueFlags(db: Db, now: Date, limit = 200): Promise<FlagRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT message_id, group_id, priority, reply_state, source, reason, due_at, seen_at, handled_at FROM message_flag
     WHERE reply_state IN (?, ?) AND due_at IS NOT NULL AND due_at <= ?
     ORDER BY due_at LIMIT ?`,
    [ReplyState.Waiting, ReplyState.Seen, now, limit]);
  return rows as FlagRow[];
}

export interface ReactionInput {
  groupId: number;
  zaloMsgId: string;
  reactorUid: string;
  /** Rỗng = gỡ cảm xúc. */
  icon: string;
  at: Date;
}

/**
 * Ghi một lần thả / gỡ cảm xúc. Tin không có trong kho (nhóm không đọc, tin trước ngày bot vào) thì bỏ qua.
 * Thả cảm xúc lên tin đang chờ trả lời thì đánh dấu «đã xem». Trả về id tin trong kho (null = không có).
 */
export async function recordReaction(db: Db, input: ReactionInput): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id FROM message WHERE group_id = ? AND zalo_msg_id = ?", [input.groupId, input.zaloMsgId]);
  const messageId = rows[0] ? Number(rows[0].id) : null;
  if (!messageId) return null;
  if (!input.icon) {
    await db.query("DELETE FROM message_reaction WHERE message_id = ? AND reactor_uid = ?", [messageId, input.reactorUid]);
    return messageId;
  }
  await db.query(
    `INSERT INTO message_reaction (message_id, reactor_uid, icon, reacted_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE icon = VALUES(icon), reacted_at = VALUES(reacted_at)`,
    [messageId, input.reactorUid.slice(0, 40), input.icon.slice(0, 40), input.at]);
  await markFlagSeen(db, messageId, input.reactorUid, input.at);
  return messageId;
}
