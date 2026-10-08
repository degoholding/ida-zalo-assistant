import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import type { FileStorage } from "../storage/file-storage.js";
import { AttachmentStatus } from "../constants.js";
import { recountThread } from "./message-ingest.js";

// Hết thời hạn lưu của nhóm (retention_days) thì xóa tin + file thật — thời hạn lưu là cam kết
// với người trong nhóm (NĐ 13/2023), không phải con số trang trí.
//
// Chạy THEO TỪNG NHÓM với mốc của nhóm đó, để câu truy vấn đi đúng chỉ mục (group_id, sent_at).
// Viết một câu so mọi tin với retention_days của nhóm nó thì MySQL phải quét cả bảng tin.

const BATCH_SIZE = 500;
const log = createLogger("retention");

export async function purgeExpiredMessages(db: Db, storage: FileStorage): Promise<{ messages: number; files: number }> {
  let messages = 0;
  let files = 0;
  const [groups] = await db.query<RowDataPacket[]>("SELECT id, retention_days FROM zalo_group");
  const purgedGroups = new Set<number>();
  for (const group of groups) {
    const cutoff = new Date(Date.now() - (group.retention_days as number) * 86_400_000);
    for (;;) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT m.id, a.storage_key
         FROM message m LEFT JOIN attachment a ON a.message_id = m.id
         WHERE m.group_id = ? AND m.sent_at < ?
         ORDER BY m.sent_at
         LIMIT ?`,
        [group.id, cutoff, BATCH_SIZE],
      );
      if (!rows.length) break;
      // Xóa tệp trước, dòng sau: hỏng giữa chừng thì lần sau còn dòng để xóa lại tệp
      for (const row of rows) {
        if (!row.storage_key) continue;
        await storage.delete(row.storage_key as string);
        files += 1;
      }
      const [result] = await db.query<ResultSetHeader>("DELETE FROM message WHERE id IN (?)", [rows.map((row) => row.id)]);
      messages += result.affectedRows;
      purgedGroups.add(group.id as number);
      if (rows.length < BATCH_SIZE) break;
    }
  }
  for (const groupId of purgedGroups) await recountThread(db, groupId);
  if (messages) log.info(`đã xóa ${messages} tin quá hạn, ${files} tệp`);
  return { messages, files };
}

/**
 * Tệp gốc quá hạn giữ của nhóm (zalo_group.file_retention_days, IDA câu 20: 6 tháng): xóa tệp trong kho, giữ dòng
 * attachment (chuyển trạng thái Expired) và chữ đã bóc ở attachment_text — vẫn tìm / tóm tắt được, chỉ không tải tệp
 * gốc nữa. Tệp đánh dấu «giữ» (keep_file) không đụng. Tin vẫn theo retention_days.
 */
export async function purgeExpiredFiles(db: Db, storage: FileStorage, now: Date = new Date()): Promise<number> {
  let files = 0;
  const [groups] = await db.query<RowDataPacket[]>("SELECT id, file_retention_days FROM zalo_group");
  for (const group of groups) {
    const cutoff = new Date(now.getTime() - Number(group.file_retention_days) * 86_400_000);
    for (;;) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT id, storage_key FROM attachment
         WHERE group_id = ? AND created_at < ? AND status = ? AND keep_file = 0
         ORDER BY created_at LIMIT ?`,
        [group.id, cutoff, AttachmentStatus.Stored, BATCH_SIZE],
      );
      if (!rows.length) break;
      // Xóa tệp trước, đổi trạng thái sau: hỏng giữa chừng thì lần sau còn dòng Stored để xóa lại
      for (const row of rows) {
        if (row.storage_key) await storage.delete(String(row.storage_key));
      }
      const [result] = await db.query<ResultSetHeader>(
        "UPDATE attachment SET status = ?, storage_key = NULL WHERE id IN (?)",
        [AttachmentStatus.Expired, rows.map((row) => row.id)],
      );
      files += result.affectedRows;
      if (rows.length < BATCH_SIZE) break;
    }
  }
  if (files) log.info(`đã xóa ${files} tệp gốc quá hạn giữ (còn chữ đã bóc)`);
  return files;
}
