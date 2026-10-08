import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { JobKind, JobStatus } from "../constants.js";
import type { Db } from "../db/pool.js";

// Hàng đợi việc bền trên bảng `job` (migration 016). Nhiều tiến trình cùng lấy việc an toàn nhờ
// SELECT … FOR UPDATE SKIP LOCKED; việc cùng `serial_key` không bao giờ chạy song song (kể cả khác tiến trình).

export interface EnqueueOptions {
  kind: JobKind;
  payload: unknown;
  /** Chống trùng: đã có việc cùng khóa (ở bất kỳ trạng thái nào) thì không ghi nữa. */
  dedupeKey?: string;
  /** Việc cùng khóa chạy lần lượt. */
  serialKey?: string;
  /** Chạy sớm nhất lúc này (mặc định ngay). */
  runAfter?: Date;
  /** Chờ quá ngần này mili giây mà chưa chạy thì bỏ. */
  expiresInMs?: number;
  maxAttempts?: number;
}

export interface JobRow {
  id: number;
  kind: JobKind;
  payload: unknown;
  serialKey: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
}

/** Khóa chuỗi cột VARCHAR(191) — cắt cho vừa (khóa dài chỉ xảy ra khi mã Zalo bất thường). */
const fitKey = (key: string | undefined): string | null => (key ? key.slice(0, 191) : null);

/** Ghi một việc. Trả về id, hoặc null nếu trùng `dedupeKey` (việc đã có rồi). */
export async function enqueueJob(db: Db, options: EnqueueOptions): Promise<number | null> {
  const expiresAt = options.expiresInMs ? new Date((options.runAfter?.getTime() ?? Date.now()) + options.expiresInMs) : null;
  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO job (kind, payload, dedupe_key, serial_key, run_after, expires_at, max_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [options.kind, JSON.stringify(options.payload ?? null), fitKey(options.dedupeKey), fitKey(options.serialKey),
      options.runAfter ?? new Date(), expiresAt, options.maxAttempts ?? 3],
  );
  return result.affectedRows ? result.insertId : null;
}

/** Giãn cách thử lại: 10 giây × số lần đã thử², trần 10 phút. Hàm thuần. */
export function retryDelayMs(attempts: number): number {
  return Math.min(10 * 60_000, 10_000 * Math.max(1, attempts) ** 2);
}

/**
 * Trong một lô việc chờ đã xếp theo id: bỏ việc có `serialKey` đang chạy ở đâu đó, và mỗi `serialKey` chỉ lấy
 * việc đầu tiên. Hàm thuần — tách ra để kiểm không cần CSDL.
 */
export function pickRunnable<T extends { serialKey: string | null }>(candidates: T[], busySerialKeys: Set<string>, limit: number): T[] {
  const taken = new Set(busySerialKeys);
  const picked: T[] = [];
  for (const job of candidates) {
    if (picked.length >= limit) break;
    if (job.serialKey) {
      if (taken.has(job.serialKey)) continue;
      taken.add(job.serialKey);
    }
    picked.push(job);
  }
  return picked;
}

function toJobRow(row: RowDataPacket): JobRow {
  const raw = row.payload;
  return {
    id: Number(row.id), kind: Number(row.kind) as JobKind, serialKey: row.serial_key ? String(row.serial_key) : null,
    // mysql2 trả cột JSON đã giải sẵn; phòng khi là chuỗi
    payload: typeof raw === "string" ? JSON.parse(raw) : raw,
    attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), createdAt: new Date(row.created_at),
  };
}

async function inTransaction<T>(db: Db, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

/** Số việc chờ xét mỗi lần lấy — rộng hơn `limit` để còn chỗ bỏ việc trùng `serial_key`. */
const CLAIM_SCAN_FACTOR = 5;

/**
 * Lấy tối đa `limit` việc đến hạn thuộc `kinds` và đánh dấu đang chạy. Việc quá hạn chờ (`expires_at`) chuyển sang
 * Expired trước. Hai tiến trình gọi cùng lúc không lấy trùng việc.
 */
export async function claimJobs(db: Db, workerId: string, kinds: JobKind[], limit: number): Promise<JobRow[]> {
  if (!kinds.length || limit <= 0) return [];
  await db.query(
    "UPDATE job SET status = ?, finished_at = NOW(3), last_error = 'chờ quá hạn, bỏ' WHERE status = ? AND expires_at IS NOT NULL AND expires_at < NOW(3)",
    [JobStatus.Expired, JobStatus.Pending],
  );
  return inTransaction(db, async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id, kind, payload, serial_key, attempts, max_attempts, created_at FROM job
       WHERE status = ? AND kind IN (?) AND run_after <= NOW(3)
       ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`,
      [JobStatus.Pending, kinds, limit * CLAIM_SCAN_FACTOR],
    );
    if (!rows.length) return [];
    const candidates = rows.map(toJobRow);
    const serialKeys = [...new Set(candidates.map((job) => job.serialKey).filter((key): key is string => Boolean(key)))];
    const busy = new Set<string>();
    if (serialKeys.length) {
      const [running] = await connection.query<RowDataPacket[]>(
        "SELECT DISTINCT serial_key FROM job WHERE status = ? AND serial_key IN (?)", [JobStatus.Running, serialKeys]);
      for (const row of running) busy.add(String(row.serial_key));
    }
    const picked = pickRunnable(candidates, busy, limit);
    if (!picked.length) return [];
    await connection.query(
      "UPDATE job SET status = ?, locked_by = ?, locked_at = NOW(3), attempts = attempts + 1 WHERE id IN (?)",
      [JobStatus.Running, workerId, picked.map((job) => job.id)],
    );
    return picked.map((job) => ({ ...job, attempts: job.attempts + 1 }));
  });
}

export async function completeJob(db: Db, jobId: number): Promise<void> {
  await db.query("UPDATE job SET status = ?, finished_at = NOW(3), locked_by = NULL WHERE id = ?", [JobStatus.Done, jobId]);
}

/** Việc lỗi: còn lượt thì trả về hàng chờ sau một khoảng giãn, hết lượt thì Failed. */
export async function failJob(db: Db, job: Pick<JobRow, "id" | "attempts" | "maxAttempts">, error: string): Promise<JobStatus> {
  const message = error.slice(0, 1000);
  if (job.attempts < job.maxAttempts) {
    await db.query(
      "UPDATE job SET status = ?, run_after = ?, locked_by = NULL, locked_at = NULL, last_error = ? WHERE id = ?",
      [JobStatus.Pending, new Date(Date.now() + retryDelayMs(job.attempts)), message, job.id],
    );
    return JobStatus.Pending;
  }
  await db.query("UPDATE job SET status = ?, finished_at = NOW(3), locked_by = NULL, last_error = ? WHERE id = ?",
    [JobStatus.Failed, message, job.id]);
  return JobStatus.Failed;
}

/**
 * Việc «đang chạy» bị giữ quá `staleMs` (tiến trình giữ nó đã chết giữa chừng): trả về hàng chờ nếu còn lượt thử,
 * không thì Failed. Gọi lúc khởi động và định kỳ.
 */
export async function recoverStaleJobs(db: Db, staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const [failed] = await db.query<ResultSetHeader>(
    `UPDATE job SET status = ?, finished_at = NOW(3), locked_by = NULL, last_error = 'tiến trình dừng giữa chừng, hết lượt thử'
     WHERE status = ? AND locked_at < ? AND attempts >= max_attempts`,
    [JobStatus.Failed, JobStatus.Running, cutoff]);
  const [requeued] = await db.query<ResultSetHeader>(
    `UPDATE job SET status = ?, locked_by = NULL, locked_at = NULL, last_error = 'tiến trình dừng giữa chừng, chạy lại'
     WHERE status = ? AND locked_at < ?`,
    [JobStatus.Pending, JobStatus.Running, cutoff]);
  return failed.affectedRows + requeued.affectedRows;
}

/** Xóa việc đã xong / bỏ cũ hơn `olderThanDays` ngày — giữ bảng gọn. */
export async function purgeFinishedJobs(db: Db, olderThanDays: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "DELETE FROM job WHERE status IN (?) AND finished_at < ? LIMIT 5000",
    [[JobStatus.Done, JobStatus.Failed, JobStatus.Expired], new Date(Date.now() - olderThanDays * 86_400_000)]);
  return result.affectedRows;
}

export interface QueueSummary {
  pending: number;
  running: number;
  failedToday: number;
  /** Việc chờ lâu nhất đã chờ bao nhiêu giây (0 = không có việc chờ). */
  oldestPendingSeconds: number;
}

/** Số đo hàng đợi cho màn quản trị / nhật ký. */
export async function summarizeQueue(db: Db): Promise<QueueSummary> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(status = ?) AS pending, SUM(status = ?) AS running,
       SUM(status = ? AND finished_at >= CURRENT_DATE()) AS failed_today,
       COALESCE(TIMESTAMPDIFF(SECOND, MIN(CASE WHEN status = ? AND run_after <= NOW(3) THEN run_after END), NOW(3)), 0) AS oldest
     FROM job WHERE status IN (?, ?) OR (status = ? AND finished_at >= CURRENT_DATE())`,
    [JobStatus.Pending, JobStatus.Running, JobStatus.Failed, JobStatus.Pending, JobStatus.Pending, JobStatus.Running, JobStatus.Failed]);
  const row = rows[0] ?? {};
  return { pending: Number(row.pending ?? 0), running: Number(row.running ?? 0), failedToday: Number(row.failed_today ?? 0),
    oldestPendingSeconds: Number(row.oldest ?? 0) };
}
