import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { MeetingRecordingStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";

// Bảng `meeting_recording` (migration 027) — một dòng mỗi tệp Drive mới trong thư mục «Ghi âm họp». Chống trùng bằng
// `INSERT IGNORE` trên `drive_file_id` (UNIQUE): hai worker / khởi động lại gọi `insertDiscovered` cho cùng một tệp
// chỉ dòng đầu tiên thắng. Giành lượt XỬ LÝ (phase 4) bằng `claimNext` — UPDATE có điều kiện `WHERE status = Queued`
// (khuôn giống `claimBriefLog`, nhưng ở đây chọn DÒNG CŨ NHẤT đang chờ thay vì một dòng đã biết id).

/** Kẹt `Processing` quá ngần này (tiến trình giành lượt đã chết giữa chừng) thì lượt sau trả về `Queued`. */
const STALE_PROCESSING_MS = 45 * 60_000;
/** Số dòng Queued cũ nhất thử giành mỗi lượt gọi `claimNext` — đủ để một worker bỏ qua vài dòng người khác vừa giành. */
const CLAIM_CANDIDATES = 5;

export interface DiscoveredRecording {
  tenantId?: number;
  driveFileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  driveCreatedAt: Date;
  status: MeetingRecordingStatus;
  eventId?: string;
  meetingTitle?: string;
  meetingStart?: Date;
  meetingEnd?: Date;
  targetThreadId?: number;
  requesterUid?: string;
  note?: string;
}

/** Ghi một dòng mới phát hiện — `Queued` (đã khớp + rõ nơi gửi), `Unmatched` (không khớp), hoặc `Skipped` (không phải ghi âm / không rõ nơi gửi). */
export async function insertDiscovered(db: Db, row: DiscoveredRecording): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO meeting_recording
     (tenant_id, drive_file_id, file_name, mime, size_bytes, drive_created_at, status,
      event_id, meeting_title, meeting_start, meeting_end, target_thread_id, requester_uid, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.tenantId ?? 1, row.driveFileId, row.fileName, row.mime, row.sizeBytes, row.driveCreatedAt, row.status,
      row.eventId ?? null, row.meetingTitle ?? null, row.meetingStart ?? null, row.meetingEnd ?? null,
      row.targetThreadId ?? null, row.requesterUid ?? null, row.note ?? "",
    ],
  );
  return result.affectedRows === 1;
}

/** `drive_file_id` đã có dòng trong bảng — watcher dùng để bỏ qua tệp đã xử lý khỏi lượt quét Drive. */
export async function existingDriveFileIds(db: Db, driveFileIds: string[]): Promise<Set<string>> {
  if (!driveFileIds.length) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT drive_file_id FROM meeting_recording WHERE drive_file_id IN (?)", [driveFileIds],
  );
  return new Set(rows.map((row) => String(row.drive_file_id)));
}

export interface ClaimedRecording {
  id: number;
  tenantId: number;
  /** Phase 4 (claimNext) luôn gọi SAU khi đã tự chuyển Processing nên không cần đọc; phase 6 (findByDriveFileId) đọc
   * dòng CHƯA chắc Processing — cần biết Done / Processing / còn lại để quyết định resend / báo đang xử lý / requeue. */
  status: MeetingRecordingStatus;
  driveFileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  driveCreatedAt: Date;
  eventId: string | null;
  meetingTitle: string | null;
  meetingStart: Date | null;
  meetingEnd: Date | null;
  targetThreadId: number | null;
  requesterUid: string | null;
  attempts: number;
  recapJson: Record<string, unknown> | null;
  files: unknown[] | null;
  taskIds: number[] | null;
}

function mapRow(row: RowDataPacket): ClaimedRecording {
  return {
    id: Number(row.id), tenantId: Number(row.tenant_id), status: Number(row.status), driveFileId: String(row.drive_file_id),
    fileName: String(row.file_name), mime: String(row.mime), sizeBytes: Number(row.size_bytes),
    driveCreatedAt: new Date(row.drive_created_at),
    eventId: row.event_id ? String(row.event_id) : null,
    meetingTitle: row.meeting_title ? String(row.meeting_title) : null,
    meetingStart: row.meeting_start ? new Date(row.meeting_start) : null,
    meetingEnd: row.meeting_end ? new Date(row.meeting_end) : null,
    targetThreadId: row.target_thread_id === null ? null : Number(row.target_thread_id),
    requesterUid: row.requester_uid ? String(row.requester_uid) : null,
    attempts: Number(row.attempts),
    recapJson: row.recap_json ?? null, files: row.files ?? null, taskIds: row.task_ids ?? null,
  };
}

/** Một dòng theo id — phase 4 đọc lại sau `claimNext` (hoặc để thử lại trên dòng đã có `recap_json`). */
export async function findById(db: Db, id: number): Promise<ClaimedRecording | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM meeting_recording WHERE id = ?", [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Dòng theo `drive_file_id` — recap theo yêu cầu chat (phase 6, meeting-recap-ondemand.ts) kiểm tệp đã có dòng chưa
 * trước khi tạo mới / xếp lại hàng (resend nếu Done, báo đang xử lý nếu Processing, requeue nếu còn lại). */
export async function findByDriveFileId(db: Db, driveFileId: string): Promise<ClaimedRecording | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM meeting_recording WHERE drive_file_id = ?", [driveFileId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface OndemandRequeuePatch {
  targetThreadId?: number;
  requesterUid?: string;
  eventId?: string;
  meetingTitle?: string;
  meetingStart?: Date;
  meetingEnd?: Date;
}

/**
 * Recap theo yêu cầu chat (phase 6) cho một dòng ĐÃ CÓ (Queued / Unmatched / Skipped / Failed — Processing và Done đã
 * được xử lý riêng ở meeting-recap-ondemand.ts trước khi gọi tới đây): đặt lại `Queued`, đích gửi = CUỘC ĐANG HỎI (ghi
 * đè thẳng, có thể khác đích cũ nếu lần quét trước đoán sai / chưa rõ), RESET `attempts` về 0 (người dùng chủ động hỏi
 * lại — không tính lỗi / số lần thử cũ), xóa `retry_after` / `note` / `error`. GIỮ `recap_json` / `files` / `task_ids`
 * nếu dòng cũ đã lỡ dở sau bước nghe AI (thử lại không tốn AI / PDF / việc lần hai).
 */
export async function requeueOndemand(db: Db, id: number, patch: OndemandRequeuePatch): Promise<void> {
  await db.query(
    `UPDATE meeting_recording
     SET status = ?, attempts = 0, retry_after = NULL, note = '', error = '', claimed_at = NULL, done_at = NULL,
         target_thread_id = ?, requester_uid = ?,
         event_id = COALESCE(?, event_id), meeting_title = COALESCE(?, meeting_title),
         meeting_start = COALESCE(?, meeting_start), meeting_end = COALESCE(?, meeting_end)
     WHERE id = ?`,
    [MeetingRecordingStatus.Queued, patch.targetThreadId ?? null, patch.requesterUid ?? null,
     patch.eventId ?? null, patch.meetingTitle ?? null, patch.meetingStart ?? null, patch.meetingEnd ?? null, id],
  );
}

/**
 * Giành lượt xử lý MỘT dòng `Queued` (cũ nhất trước) — UPDATE có điều kiện `WHERE id = ? AND status = Queued` nên hai
 * worker thử cùng lúc chỉ một bên thắng (affectedRows = 1); bên thua thử dòng kế trong danh sách ứng viên. `attempts`
 * tăng ngay lúc giành (kể cả xử lý lỗi giữa chừng cũng tính một lần thử — phase 4 đọc `attempts` để quyết định Failed).
 */
export async function claimNext(db: Db, now: Date, maxAttempts: number): Promise<ClaimedRecording | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    // M2: bỏ qua dòng đang hoãn vì trần token (retry_after trong tương lai) — không để nó chặn các dòng Queued SAU nó
    "SELECT id FROM meeting_recording WHERE status = ? AND attempts < ? AND (retry_after IS NULL OR retry_after <= ?) ORDER BY created_at ASC LIMIT ?",
    [MeetingRecordingStatus.Queued, maxAttempts, now, CLAIM_CANDIDATES],
  );
  for (const row of rows) {
    const id = Number(row.id);
    const [update] = await db.query<ResultSetHeader>(
      "UPDATE meeting_recording SET status = ?, claimed_at = ?, attempts = attempts + 1 WHERE id = ? AND status = ?",
      [MeetingRecordingStatus.Processing, now, id, MeetingRecordingStatus.Queued],
    );
    if (update.affectedRows === 1) return findById(db, id);
  }
  return null;
}

/** Dòng `Processing` kẹt quá 45 phút (tiến trình giữ lượt đã chết) → trả về `Queued`, giữ nguyên `attempts` đã tăng lúc giành. */
export async function releaseStale(db: Db, now: Date): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE meeting_recording SET status = ? WHERE status = ? AND claimed_at < ?",
    [MeetingRecordingStatus.Queued, MeetingRecordingStatus.Processing, new Date(now.getTime() - STALE_PROCESSING_MS)],
  );
  return result.affectedRows;
}

// --- Phase 4 (gỡ băng → recap → PDF → gửi → đề xuất việc) — các hàm dưới đây ghi tiếp trên CHÍNH dòng đã `claimNext`. ---

/** Nhóm Mật / quá cỡ / chưa có khóa AI (meeting-recap-guard.ts) → dừng hẳn, không thử lại (không phải lỗi tạm thời). */
export async function markSkipped(db: Db, id: number, note: string, now: Date): Promise<void> {
  await db.query("UPDATE meeting_recording SET status = ?, note = ?, done_at = ? WHERE id = ?",
    [MeetingRecordingStatus.Skipped, note.slice(0, 200), now, id]);
}

/** Lưu recap JSON NGAY sau khi AI trả lời (đã đọc được JSON hợp lệ) — lỗi PDF / tạo việc / gửi ở bước sau thì thử lại
 * không gọi AI lần hai. Token đã cộng riêng ở `addTokens` ngay sau lượt nghe (M6: tính cả khi JSON hỏng), không cộng
 * lại ở đây. */
export async function saveRecapJson(db: Db, id: number, recapJson: Record<string, unknown>): Promise<void> {
  await db.query("UPDATE meeting_recording SET recap_json = ? WHERE id = ?", [JSON.stringify(recapJson), id]);
}

/** Cộng dồn token một lượt nghe — tách khỏi `saveRecapJson` để vẫn tính được khi parse JSON hỏng (M6), không mất, không
 * phải nghe lại miễn phí lúc thử lại. */
export async function addTokens(db: Db, id: number, tokens: { input: number; output: number }): Promise<void> {
  await db.query("UPDATE meeting_recording SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?",
    [tokens.input, tokens.output, id]);
}

export async function saveFiles(db: Db, id: number, files: GeneratedReportFile[]): Promise<void> {
  await db.query("UPDATE meeting_recording SET files = ? WHERE id = ?", [JSON.stringify(files), id]);
}

export async function saveTaskIds(db: Db, id: number, taskIds: number[]): Promise<void> {
  await db.query("UPDATE meeting_recording SET task_ids = ? WHERE id = ?", [JSON.stringify(taskIds), id]);
}

export async function markDone(db: Db, id: number, now: Date): Promise<void> {
  await db.query("UPDATE meeting_recording SET status = ?, done_at = ? WHERE id = ?", [MeetingRecordingStatus.Done, now, id]);
}

/**
 * Vượt phần còn lại của trần token NGÀY (meeting-recap-guard.ts `exceedsDailyCap`) → để `Queued` lại nhưng hoãn tới
 * `retryAfter` (M2 review 10/10/2026: trước đây claimNext giành lại dòng này mỗi 5 phút, chặn luôn các dòng Queued xếp
 * SAU nó) — KHÔNG tính là một lần thử (`claimNext` vừa tăng `attempts` lúc giành, trả lại đây).
 */
export async function deferForTokenCap(db: Db, id: number, note: string, retryAfter: Date): Promise<void> {
  await db.query("UPDATE meeting_recording SET status = ?, attempts = GREATEST(attempts - 1, 0), note = ?, retry_after = ? WHERE id = ?",
    [MeetingRecordingStatus.Queued, note.slice(0, 200), retryAfter, id]);
}

/**
 * Dừng hẳn KHÔNG qua số lần thử — ước lượng MỘT MÌNH đã vượt cả trần token của một ngày (hoãn tới ngày nào cũng vô ích,
 * M2) hoặc lỗi không thể khôi phục bằng cách thử lại. Khác `recordFailure`: luôn Failed ngay lần đầu.
 */
export async function markFailed(db: Db, id: number, error: string, now: Date): Promise<void> {
  await db.query("UPDATE meeting_recording SET status = ?, error = ?, done_at = ? WHERE id = ?",
    [MeetingRecordingStatus.Failed, error.slice(0, 500), now, id]);
}

/** Lỗi thật (AI / parse / PDF / gửi) — còn lượt thì `Queued` thử lại, hết lượt (`attempts ≥ maxAttempts`) thì `Failed`. */
export async function recordFailure(db: Db, id: number, attempts: number, maxAttempts: number, error: string, now: Date): Promise<{ failed: boolean }> {
  const failed = attempts >= maxAttempts;
  // retry_after = NULL: một lỗi THẬT (không phải hoãn trần token) phải được giành lại ngay, không kẹt theo mốc hoãn cũ
  await db.query("UPDATE meeting_recording SET status = ?, error = ?, done_at = ?, retry_after = NULL WHERE id = ?",
    [failed ? MeetingRecordingStatus.Failed : MeetingRecordingStatus.Queued, error.slice(0, 500), failed ? now : null, id]);
  return { failed };
}

/**
 * `task_ids` của recap TỰ ĐỘNG gần nhất (Done) GỬI ĐÚNG đích đang hỏi (nhóm hoặc người đặt họp tin riêng) — dùng cho
 * «ok hết» / «bỏ hết» (M3 review 10/10/2026: trước đây gộp mọi đề xuất Recap theo cửa sổ ngày, có thể cướp luồng recap
 * tay hoặc đụng đề xuất của cuộc họp khác). null = chưa có recap tự động nào khớp đích này — nơi gọi để lệnh rơi về AI.
 */
export async function findLatestRecapTaskIds(db: Db, destination: { targetThreadId: number } | { requesterUid: string }): Promise<number[] | null> {
  const isGroup = "targetThreadId" in destination;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT task_ids FROM meeting_recording
     WHERE status = ? AND task_ids IS NOT NULL AND ${isGroup ? "target_thread_id = ?" : "target_thread_id IS NULL AND requester_uid = ?"}
     ORDER BY done_at DESC, id DESC LIMIT 1`,
    [MeetingRecordingStatus.Done, isGroup ? destination.targetThreadId : destination.requesterUid],
  );
  const taskIds = rows[0]?.task_ids as unknown;
  return Array.isArray(taskIds) && taskIds.length ? taskIds.map(Number) : null;
}
