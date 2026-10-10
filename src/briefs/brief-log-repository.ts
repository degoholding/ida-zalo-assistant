import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { BriefKind, BriefStatus, BriefTrigger, JobStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import type { BriefLogFile } from "./brief-types.js";

// Bảng `brief_log` (migration 025) — một dòng mỗi lần soạn / gửi một bản tin / báo cáo. Giành lượt soạn bằng
// `INSERT IGNORE` trên `dedupe_key` (chỉ lượt THEO LỊCH mới có khóa — gọi tay / nút web xem lại mỗi lần, không chống
// trùng). Dòng kẹt `Composing` quá `STALE_COMPOSING_MS` (tiến trình chết giữa chừng) thì lượt sau soạn lại TRÊN CHÍNH
// dòng đó (không sinh dòng mới, giữ lịch sử MỘT dòng mỗi kỳ). Bộ lập lịch (`scheduler.ts`) đã bảo đảm một lượt (phút)
// của việc «briefs» chỉ một tiến trình chạy — không cần khóa tranh chấp nào thêm ở đây.

const log = createLogger("briefs");

/** Kẹt quá ngần này thì coi tiến trình soạn trước đã chết — lượt sau giành lại. */
const STALE_COMPOSING_MS = 15 * 60_000;

export interface ClaimBriefLogParams {
  tenantId?: number;
  recipientId: number;
  kind: BriefKind;
  trigger: BriefTrigger;
  periodKey: string;
  periodLabel: string;
  now: Date;
}

export interface ClaimedBriefLog {
  logId: number;
  /** false = bỏ qua lượt này (đang soạn dở / đã xong / đã lỗi trong kỳ — không soạn lại, xem log để biết lý do). */
  claimed: boolean;
}

/**
 * Giành lượt soạn một bản tin / báo cáo — xem ghi chú đầu tệp. `INSERT IGNORE` biến MỌI lỗi ghi (không chỉ trùng
 * `dedupe_key`: FK sai, dữ liệu quá dài…) thành `affectedRows = 0` — `dedupeKey` rỗng (gọi tay / nút web) không bao giờ
 * trùng (NULL không đụng UNIQUE) nên `affectedRows = 0` ở nhánh đó CHẮC CHẮN là lỗi khác, không phải tranh lượt; tương
 * tự nếu `dedupeKey` có mà SELECT lại không thấy dòng nào — ném lỗi thay vì âm thầm coi như "đã có người soạn" (review
 * phase 8, Low).
 */
export async function claimBriefLog(db: Db, params: ClaimBriefLogParams): Promise<ClaimedBriefLog> {
  const { recipientId, kind, trigger, periodKey, periodLabel, now, tenantId = 1 } = params;
  const dedupeKey = trigger === BriefTrigger.Schedule ? `r${recipientId}:${kind}:${periodKey}` : null;
  const [insert] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO brief_log (tenant_id, recipient_id, kind, trigger_source, period_key, period_label, status, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, recipientId, kind, trigger, periodKey, periodLabel, BriefStatus.Composing, dedupeKey]);
  if (insert.affectedRows) return { logId: insert.insertId, claimed: true };
  if (!dedupeKey) throw new Error(`claimBriefLog: ghi brief_log thất bại không rõ lý do (người nhận #${recipientId}, loại ${kind})`);

  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, status, created_at FROM brief_log WHERE dedupe_key = ? LIMIT 1", [dedupeKey]);
  const existing = rows[0];
  if (!existing) {
    throw new Error(`claimBriefLog: INSERT báo trùng dedupe_key «${dedupeKey}» nhưng không tìm thấy dòng cũ — lỗi ghi khác bị INSERT IGNORE nuốt`);
  }
  const stale = Number(existing.status) === BriefStatus.Composing
    && now.getTime() - new Date(existing.created_at).getTime() > STALE_COMPOSING_MS;
  if (!stale) return { logId: Number(existing.id), claimed: false };
  // Giành lại dòng Composing kẹt — UPDATE có điều kiện (đúng status CŨ + đúng created_at CŨ) + affectedRows để NGUYÊN
  // TỬ: nhiều lượt cùng phát hiện kẹt tại gần như cùng lúc thì chỉ một lượt thắng (review phase 8, M4). Mượn created_at
  // làm mốc "bắt đầu soạn lại" luôn — cùng cột đã dùng để tính kẹt ở trên, khỏi thêm cột mới.
  const [reclaim] = await db.query<ResultSetHeader>(
    "UPDATE brief_log SET created_at = ? WHERE id = ? AND status = ? AND created_at = ?",
    [now, existing.id, BriefStatus.Composing, existing.created_at]);
  return { logId: Number(existing.id), claimed: reclaim.affectedRows === 1 };
}

/**
 * Dọn brief_log Queued mà job gửi đã HẾT HẠN hàng đợi (`claimJobs` tự chuyển Pending → Expired khi quá `expires_at`,
 * KHÔNG chạy qua bộ xử lý của sync-service.ts nên không có cơ hội tự ghi Failed) — join theo `dedupe_key = brief:<id>`
 * (brief-delivery.ts) để biết job tương ứng. Gọi mỗi lượt `runBriefs` (review phase 8, M3).
 */
export async function reconcileExpiredBriefJobs(db: Db, now: Date): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE brief_log b JOIN job j ON j.dedupe_key = CONCAT('brief:', b.id)
     SET b.status = ?, b.error = 'Hết hạn hàng đợi gửi — chưa gửi được lần nào.'
     WHERE b.status = ? AND j.status = ?`,
    [BriefStatus.Failed, BriefStatus.Queued, JobStatus.Expired]);
  if (result.affectedRows) log.warn(`${result.affectedRows} bản tin / báo cáo hết hạn hàng đợi, đã ghi Failed (mốc kiểm ${now.toISOString()})`);
  return result.affectedRows;
}

/**
 * Soạn xong: ghi chữ bản tin, xếp vào hàng (chờ gửi), vì sao bỏ mục điểm tin AI (rỗng = có điểm tin). `files` — PDF /
 * Excel đính kèm (phase 3, báo cáo tuần / tháng); rỗng ở bản tin sáng / cuối ngày.
 */
export async function saveComposed(db: Db, logId: number, body: string, aiNote: string, files: BriefLogFile[] = []): Promise<void> {
  await db.query("UPDATE brief_log SET body = ?, status = ?, ai_note = ?, files = ? WHERE id = ?",
    [body, BriefStatus.Queued, aiNote.slice(0, 200), JSON.stringify(files), logId]);
}

/** App gửi xong (sync-service.ts, sau khi `enqueueRecipientMessage` thành công). */
export async function markBriefSent(db: Db, logId: number, sentAt: Date = new Date()): Promise<void> {
  await db.query("UPDATE brief_log SET status = ?, sent_at = ? WHERE id = ?", [BriefStatus.Sent, sentAt, logId]);
}

/** Soạn lỗi — không thử lại trong ngày (đọc log / màn Bản tin để biết lý do). */
export async function markBriefFailed(db: Db, logId: number, error: string): Promise<void> {
  await db.query("UPDATE brief_log SET status = ?, error = ? WHERE id = ?", [BriefStatus.Failed, error.slice(0, 500), logId]);
}
