import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ConversationType, JobStatus, SendTargetStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { FileStorage } from "../storage/file-storage.js";

// Xóa TÀI KHOẢN THỬ kèm dữ liệu (27/10/2026). Chỉ bot_account.is_test = 1; tài khoản thật chỉ Tắt.
//   Xóa: cuộc riêng 1-1 của nó (zalo_group thread_type riêng, owner_bot_id = nó) + nhóm CHỈ có mình nó (bot_group không có dòng
//   nào của tài khoản khác, kể cả dòng đã rời) + chính bot_account. Nhóm có tài khoản khác: giữ nguyên, chỉ mất dòng bot_group
//   của nó (FK cascade).
//   Theo FK cascade khi xóa zalo_group: message → attachment → attachment_text, message_flag, message_reaction, message_search,
//   group_member, bot_group. Khi xóa bot_account: bot_group, session_event, assistant_turn, friend_request.
//   Bảng trỏ tới cuộc / tin / tệp KHÔNG có FK: dọn tay trong cùng giao dịch (xem `detachSoftReferences`).
//   Tệp trong kho (đĩa / R2) xóa SAU khi giao dịch xong; hỏng thì ghi storage_cleanup để việc nền dọn lại.

const log = createLogger("test-account-purge");
const PURGED_NOTE = "Tài khoản thử đã xóa";

export class PurgeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeRefusedError";
  }
}

export interface PurgePlan {
  accountId: number;
  label: string;
  /** id các cuộc sẽ xóa (cuộc riêng + nhóm chỉ có mình nó) */
  threadIds: number[];
  directCount: number;
  soloGroupCount: number;
  /** nhóm có tài khoản khác: giữ, chỉ bỏ liên kết */
  sharedGroupCount: number;
  messageCount: number;
  attachmentCount: number;
  /** tệp đang có trong kho (sẽ xóa khỏi đĩa / R2) */
  storedFileCount: number;
  storedBytes: number;
}

export interface PurgeResult extends PurgePlan {
  storageDeleted: number;
  storageFailed: number;
}

type Queryable = Pick<Db, "query"> | PoolConnection;

/** Liệt kê những gì SẼ xóa — không ghi gì. Tài khoản thật / không có → PurgeRefusedError. */
export async function planTestAccountPurge(db: Queryable, accountId: number): Promise<PurgePlan> {
  const [accounts] = await db.query<RowDataPacket[]>("SELECT id, label, is_test FROM bot_account WHERE id = ?", [accountId]);
  const account = accounts[0];
  if (!account) throw new PurgeRefusedError("Không có tài khoản bot này");
  if (!Number(account.is_test)) throw new PurgeRefusedError("Chỉ xóa được tài khoản đánh dấu Tài khoản thử — tài khoản thật chỉ Tắt.");

  const [direct] = await db.query<RowDataPacket[]>(
    "SELECT id FROM zalo_group WHERE thread_type = ? AND owner_bot_id = ?", [ConversationType.Direct, accountId]);
  // Nhóm CHỈ có mình nó: tính cả dòng bot_group đã rời của tài khoản khác — từng có tài khoản khác ở là GIỮ
  const [solo] = await db.query<RowDataPacket[]>(
    `SELECT g.id FROM zalo_group g
     WHERE g.thread_type = ? AND EXISTS (SELECT 1 FROM bot_group mine WHERE mine.group_id = g.id AND mine.bot_account_id = ?)
       AND NOT EXISTS (SELECT 1 FROM bot_group other WHERE other.group_id = g.id AND other.bot_account_id <> ?)`,
    [ConversationType.Group, accountId, accountId]);
  const [shared] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT mine.group_id) AS total FROM bot_group mine
     WHERE mine.bot_account_id = ? AND EXISTS (SELECT 1 FROM bot_group other WHERE other.group_id = mine.group_id AND other.bot_account_id <> ?)`,
    [accountId, accountId]);
  const threadIds = [...direct, ...solo].map((row) => Number(row.id));
  const plan: PurgePlan = {
    accountId, label: String(account.label), threadIds, directCount: direct.length, soloGroupCount: solo.length,
    sharedGroupCount: Number(shared[0]?.total ?? 0), messageCount: 0, attachmentCount: 0, storedFileCount: 0, storedBytes: 0,
  };
  if (!threadIds.length) return plan;
  const [messages] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM message WHERE group_id IN (?)", [threadIds]);
  const [files] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(storage_key IS NOT NULL) AS stored_count, COALESCE(SUM(IF(storage_key IS NULL, 0, stored_bytes)), 0) AS bytes
     FROM attachment WHERE group_id IN (?)`, [threadIds]);
  plan.messageCount = Number(messages[0]?.total ?? 0);
  plan.attachmentCount = Number(files[0]?.total ?? 0);
  plan.storedFileCount = Number(files[0]?.stored_count ?? 0);
  plan.storedBytes = Number(files[0]?.bytes ?? 0);
  return plan;
}

/**
 * Bảng trỏ tới cuộc / tin / tệp mà KHÔNG có FK — dọn trước khi xóa cuộc để không còn dòng mồ côi. Việc / ticket / lệnh gửi là
 * hồ sơ công việc nên GIỮ, chỉ gỡ con trỏ nguồn; dòng chỉ có nghĩa khi cuộc còn (phạm vi người dùng, người nhận theo nhóm,
 * nhật ký cảnh báo, tệp đính kèm ticket) thì xóa.
 */
async function detachSoftReferences(conn: Queryable, accountId: number, threadIds: number[]): Promise<void> {
  if (threadIds.length) {
    await conn.query(
      `UPDATE job SET status = ?, last_error = ?, finished_at = NOW(3)
       WHERE status = ? AND (CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.threadId')) AS UNSIGNED) IN (?)
         OR CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.groupId')) AS UNSIGNED) IN (?))`,
      [JobStatus.Expired, PURGED_NOTE, JobStatus.Pending, threadIds, threadIds]);
    await conn.query("UPDATE task SET source_thread_id = NULL, source_message_id = NULL WHERE source_thread_id IN (?)", [threadIds]);
    await conn.query("UPDATE ticket SET source_thread_id = NULL, source_message_id = NULL WHERE source_thread_id IN (?)", [threadIds]);
    await conn.query("UPDATE send_command SET source_thread_id = NULL, source_message_id = NULL WHERE source_thread_id IN (?)", [threadIds]);
    // Nơi nhận còn chờ gửi vào cuộc sắp mất → hủy (gửi tiếp sẽ hỏng); nơi nhận đã xong giữ lịch sử, chỉ gỡ con trỏ cuộc
    await conn.query(
      "UPDATE send_command_target SET status = ? WHERE thread_id IN (?) AND status IN (?)",
      [SendTargetStatus.Cancelled, threadIds, [SendTargetStatus.Pending, SendTargetStatus.Queued]]);
    await conn.query("UPDATE send_command_target SET thread_id = NULL WHERE thread_id IN (?)", [threadIds]);
    await conn.query("UPDATE meeting_recording SET target_thread_id = NULL WHERE target_thread_id IN (?)", [threadIds]);
    await conn.query("DELETE FROM ticket_attachment WHERE attachment_id IN (SELECT id FROM attachment WHERE group_id IN (?))", [threadIds]);
    await conn.query("DELETE FROM alert_log WHERE message_id IN (SELECT id FROM message WHERE group_id IN (?))", [threadIds]);
    await conn.query("DELETE FROM user_group_scope WHERE group_id IN (?)", [threadIds]);
    await conn.query("DELETE FROM recipient_group WHERE group_id IN (?)", [threadIds]);
    await conn.query("DELETE FROM assistant_turn WHERE thread_id IN (?)", [threadIds]);
  }
  await conn.query("UPDATE ticket SET bot_account_id = NULL WHERE bot_account_id = ?", [accountId]);
  await conn.query("UPDATE send_command SET bot_account_id = NULL WHERE bot_account_id = ?", [accountId]);
}

/**
 * Xóa tài khoản thử + dữ liệu. Người gọi PHẢI dừng phiên Zalo trước (runner còn chạy sẽ ghi tin mới vào cuộc đang xóa).
 * Phần DB trong MỘT giao dịch (lập lại kế hoạch bên trong, khóa dòng tài khoản); tệp trong kho xóa sau khi commit.
 */
export async function purgeTestAccount(db: Db, storage: FileStorage, accountId: number): Promise<PurgeResult> {
  const conn = await db.getConnection();
  let plan: PurgePlan;
  let storageKeys: string[] = [];
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM bot_account WHERE id = ? FOR UPDATE", [accountId]);
    plan = await planTestAccountPurge(conn, accountId);
    const { threadIds } = plan;
    if (threadIds.length) {
      const [files] = await conn.query<RowDataPacket[]>(
        "SELECT storage_key FROM attachment WHERE group_id IN (?) AND storage_key IS NOT NULL", [threadIds]);
      const [avatars] = await conn.query<RowDataPacket[]>(
        "SELECT avatar_key FROM zalo_group WHERE id IN (?) AND avatar_key IS NOT NULL", [threadIds]);
      storageKeys = [...files.map((row) => String(row.storage_key)), ...avatars.map((row) => String(row.avatar_key))];
    }
    await detachSoftReferences(conn, accountId, threadIds);
    if (threadIds.length) await conn.query("DELETE FROM zalo_group WHERE id IN (?)", [threadIds]);
    const [deleted] = await conn.query<ResultSetHeader>("DELETE FROM bot_account WHERE id = ? AND is_test = 1", [accountId]);
    if (deleted.affectedRows !== 1) throw new PurgeRefusedError("Tài khoản đã đổi trạng thái trong lúc xóa — không xóa gì.");
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }

  let storageDeleted = 0;
  let storageFailed = 0;
  for (const key of storageKeys) {
    try {
      await storage.delete(key);
      storageDeleted += 1;
    } catch (error) {
      storageFailed += 1;
      const message = describeError(error);
      log.warn(`xóa tệp ${key} lỗi, ghi để dọn sau: ${message}`);
      await db.query("INSERT INTO storage_cleanup (storage_key, reason, last_error) VALUES (?, ?, ?)",
        [key.slice(0, 500), `${PURGED_NOTE} #${accountId}`.slice(0, 200), message.slice(0, 500)])
        .catch((insertError) => log.error(`không ghi được storage_cleanup cho ${key}: ${describeError(insertError)}`));
    }
  }
  return { ...plan, storageDeleted, storageFailed };
}

/** Việc nền: thử xóa lại tệp còn nợ trong storage_cleanup (xóa được thì bỏ dòng). Trả số tệp đã dọn. */
export async function retryStorageCleanup(db: Db, storage: FileStorage, limit = 200): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, storage_key FROM storage_cleanup ORDER BY id LIMIT ?", [limit]);
  let cleaned = 0;
  for (const row of rows) {
    try {
      await storage.delete(String(row.storage_key));
      await db.query("DELETE FROM storage_cleanup WHERE id = ?", [row.id]);
      cleaned += 1;
    } catch (error) {
      await db.query("UPDATE storage_cleanup SET attempts = attempts + 1, last_error = ? WHERE id = ?",
        [describeError(error).slice(0, 500), row.id]);
    }
  }
  return cleaned;
}
