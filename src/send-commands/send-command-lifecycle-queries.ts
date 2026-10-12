import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, JobStatus, SendCommandSource, SendCommandStatus, SendTargetStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { findCommand } from "./send-command-repository.js";
import type { SendCommandRow } from "./send-command-types.js";

// Truy vấn phụ của vòng đời lệnh gửi (phase 9) — bổ sung cho send-command-repository.ts (không sửa tệp phase 1).
// Mọi câu đọc nhiều dòng đều có LIMIT.

const BATCH = 100;

/** Nháp còn sống (chưa quá hạn xác nhận) mới nhất của một người — «đồng ý» / «hủy» trần trỏ vào đây. */
export async function findLatestLiveDraft(db: Db, uid: string, now: Date): Promise<SendCommandRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM send_command WHERE requester_uid = ? AND source = ? AND status = ? AND confirm_expires_at > ?
     ORDER BY id DESC LIMIT 1`,
    [uid, SendCommandSource.Zalo, SendCommandStatus.Draft, now]);
  return rows[0] ? findCommand(db, Number(rows[0].id)) : null;
}

/** Mỗi người MỘT nháp sống: nháp cũ sang Expired trước khi dựng nháp mới. */
export async function expireRequesterDrafts(db: Db, uid: string): Promise<void> {
  await db.query("UPDATE send_command SET status = ? WHERE requester_uid = ? AND source = ? AND status = ?",
    [SendCommandStatus.Expired, uid, SendCommandSource.Zalo, SendCommandStatus.Draft]);
}

/** Đổi trạng thái lệnh có điều kiện (chỉ khi đang ở `from`). true = đã đổi. */
export async function setCommandStatusIf(db: Db, id: number, from: SendCommandStatus[], to: SendCommandStatus): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("UPDATE send_command SET status = ? WHERE id = ? AND status IN (?)", [to, id, from]);
  return result.affectedRows === 1;
}

/** Giành lượt báo kết quả: đúng MỘT lời gọi thấy true (reported_at đang NULL). */
export async function claimReport(db: Db, id: number, now: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>("UPDATE send_command SET reported_at = ? WHERE id = ? AND reported_at IS NULL", [now, id]);
  return result.affectedRows === 1;
}

export async function releaseReport(db: Db, id: number): Promise<void> {
  await db.query("UPDATE send_command SET reported_at = NULL WHERE id = ?", [id]);
}

/** Số nơi còn Pending / Queued của một lệnh. */
export async function countOpenTargets(db: Db, commandId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM send_command_target WHERE command_id = ? AND status IN (?, ?)",
    [commandId, SendTargetStatus.Pending, SendTargetStatus.Queued]);
  return Number(rows[0]?.n ?? 0);
}

/** Bỏ các job còn Pending (lệnh bị hủy) — job đang chạy / đã xong không đụng tới. */
export async function expirePendingJobs(db: Db, jobIds: number[], reason: string): Promise<void> {
  if (!jobIds.length) return;
  await db.query(
    "UPDATE job SET status = ?, last_error = ?, finished_at = CURRENT_TIMESTAMP(3) WHERE id IN (?) AND status = ?",
    [JobStatus.Expired, reason.slice(0, 1000), jobIds, JobStatus.Pending]);
}

export async function countTargetsByCommand(db: Db, commandIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!commandIds.length) return counts;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT command_id, COUNT(*) AS n FROM send_command_target WHERE command_id IN (?) GROUP BY command_id", [commandIds]);
  for (const row of rows) counts.set(Number(row.command_id), Number(row.n));
  return counts;
}

export interface RecentFile {
  id: number;
  fileName: string;
  status: AttachmentStatus;
}

/** Tệp / ảnh người ra lệnh gửi trong cuộc riêng từ `since`, tới tin lệnh (cũ → mới). */
export async function findRecentFiles(db: Db, threadId: number, uid: string, uptoMessageId: number | null, since: Date, limit: number): Promise<RecentFile[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT a.id, a.file_name, a.status FROM attachment a JOIN message m ON m.id = a.message_id
     WHERE m.group_id = ? AND m.sender_uid = ? AND m.sent_at >= ? AND m.recalled_at IS NULL ${uptoMessageId ? "AND m.id <= ?" : ""}
       AND a.status <> ?
     ORDER BY m.id DESC LIMIT ?`,
    [threadId, uid, since, ...(uptoMessageId ? [uptoMessageId] : []), AttachmentStatus.Expired, limit]);
  return rows.map((row) => ({ id: Number(row.id), fileName: String(row.file_name || "tệp"), status: Number(row.status) })).reverse();
}

/** Tệp chưa vào kho (bỏ qua / tải lỗi) → đưa lại hàng tải; trả các id đã đặt lại. */
export async function resetFilesForDownload(db: Db, files: RecentFile[]): Promise<number[]> {
  const ids = files.filter((file) => [AttachmentStatus.Skipped, AttachmentStatus.Failed].includes(file.status)).map((file) => file.id);
  if (!ids.length) return [];
  await db.query("UPDATE attachment SET status = ?, attempts = 0, last_error = '' WHERE id IN (?) AND status IN (?, ?)",
    [AttachmentStatus.Pending, ids, AttachmentStatus.Skipped, AttachmentStatus.Failed]);
  return ids;
}

export async function listAttachmentNames(db: Db, ids: number[]): Promise<string[]> {
  if (!ids.length) return [];
  const [rows] = await db.query<RowDataPacket[]>("SELECT file_name FROM attachment WHERE id IN (?) ORDER BY id LIMIT 20", [ids]);
  return rows.map((row) => String(row.file_name || "tệp"));
}

export interface StaleTarget {
  id: number;
  commandId: number;
  /** Lý do ghi vào nơi nhận Failed */
  error: string;
}

/**
 * Nơi nhận mắc kẹt cho việc nền: (1) Queued mà job Expired / Failed / mất / chưa có; (2) Pending trong lệnh đã xác nhận
 * (xác nhận bị ngắt giữa chừng). Chỉ xét dòng không đổi quá 2 phút — tránh đụng lúc «đồng ý» đang xếp job.
 */
export async function listStaleTargets(db: Db, now: Date): Promise<StaleTarget[]> {
  const settled = new Date(now.getTime() - 2 * 60_000);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.id, t.command_id, t.status, j.status AS job_status, j.last_error
     FROM send_command_target t JOIN send_command c ON c.id = t.command_id LEFT JOIN job j ON j.id = t.job_id
     WHERE t.updated_at < ? AND c.status IN (?, ?)
       AND ((t.status = ? AND (t.job_id IS NULL OR j.id IS NULL OR j.status IN (?, ?))) OR t.status = ?)
     ORDER BY t.id LIMIT ${BATCH}`,
    [settled, SendCommandStatus.Scheduled, SendCommandStatus.Sending, SendTargetStatus.Queued, JobStatus.Expired, JobStatus.Failed, SendTargetStatus.Pending]);
  return rows.map((row) => {
    const status = Number(row.status);
    const jobStatus = row.job_status === null ? null : Number(row.job_status);
    const lastError = String(row.last_error ?? "");
    let error = "chưa kịp xếp việc gửi — gửi lại từ màn Gửi tin";
    if (status === SendTargetStatus.Queued) {
      if (jobStatus === JobStatus.Expired) error = lastError || "quá giờ hẹn 2 giờ, không gửi bù";
      else if (jobStatus === JobStatus.Failed) error = lastError || "gửi lỗi";
      else error = "việc gửi không còn trong hàng đợi";
    }
    return { id: Number(row.id), commandId: Number(row.command_id), error };
  });
}

/** Lệnh cần chốt: đang gửi / hẹn mà hết nơi chờ, hoặc đã xong nhưng chưa báo kết quả (nguồn Zalo). */
export async function listFinalizeCandidates(db: Db, now: Date): Promise<number[]> {
  const settled = new Date(now.getTime() - 2 * 60_000);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id FROM send_command c
     WHERE c.updated_at < ? AND (
       (c.status IN (?, ?) AND NOT EXISTS (SELECT 1 FROM send_command_target t WHERE t.command_id = c.id AND t.status IN (?, ?)))
       OR (c.status = ? AND c.source = ? AND c.reported_at IS NULL))
     ORDER BY c.id LIMIT ${BATCH}`,
    [settled, SendCommandStatus.Scheduled, SendCommandStatus.Sending, SendTargetStatus.Pending, SendTargetStatus.Queued, SendCommandStatus.Done, SendCommandSource.Zalo]);
  return rows.map((row) => Number(row.id));
}
