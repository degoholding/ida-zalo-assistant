import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";

// Giữ bảng tìm message_search (migration 023) khớp với bảng message. Ba đường:
// - Tin mới / tin được bổ sung chữ: indexMessage ngay sau khi ghi (message-ingest, imports-api).
// - Tin thu hồi: unindexMessage (thu hồi = rút lời, không được tìm ra nữa). Xóa tin thì khóa ngoại tự xóa.
// - Tin có từ TRƯỚC khi có bảng tìm: việc nền «search-index» gọi backfillMessageSearch mỗi phút, chép theo lô id từ mới về
//   cũ — tin gần đây tìm được trước, bảng message không bị khóa ghi (mỗi lô là một câu ngắn trên khoảng khóa chính).
// THÊM CHỖ GHI message.text MỚI thì phải gọi indexMessage — không thì tin đó không bao giờ tìm ra.

const log = createLogger("search-index");

/** Số id mỗi lô chép tin cũ — tin thường ngắn, 5.000 tin ~1 MB chữ, một câu chạy dưới 1 giây. */
const BACKFILL_BATCH_IDS = 5000;
/** Nghỉ giữa hai lô để việc khác (ghi tin, trả lời) chen vào MySQL. */
const BACKFILL_PAUSE_MS = 50;
/** Một lượt việc nền chép tối đa ngần này rồi nhường — lịch chạy mỗi phút, lượt sau chép tiếp. */
export const BACKFILL_BUDGET_MS = 40_000;
const META_NAME = "message_search";
const COVERAGE_TTL_MS = 60_000;

/** Điều kiện «tin này phải có trong bảng tìm» — dùng chung cho ghi lẻ và chép lô. */
const SEARCHABLE = "m.text IS NOT NULL AND m.text <> '' AND m.recalled_at IS NULL";
const COPY_SELECT = `SELECT m.id, m.group_id, m.sent_at, m.text FROM message m`;

/**
 * Chép (lại) chữ của một tin vào bảng tìm. Lỗi chỉ ghi log — không được làm hỏng việc lưu tin; tin lỡ thiếu thì chỉ là
 * không tìm ra, không mất dữ liệu.
 */
export async function indexMessage(db: Db, messageId: number): Promise<void> {
  try {
    await db.query(
      `INSERT INTO message_search (message_id, group_id, sent_at, text) ${COPY_SELECT} WHERE m.id = ? AND ${SEARCHABLE}
       ON DUPLICATE KEY UPDATE text = m.text`,
      [messageId]);
  } catch (error) {
    log.warn(`không ghi được tin ${messageId} vào bảng tìm`, error);
  }
}

/** Bỏ một tin khỏi bảng tìm (thu hồi). Lỗi chỉ ghi log như indexMessage. */
export async function unindexMessage(db: Db, messageId: number): Promise<void> {
  try {
    await db.query("DELETE FROM message_search WHERE message_id = ?", [messageId]);
  } catch (error) {
    log.warn(`không bỏ được tin ${messageId} khỏi bảng tìm`, error);
  }
}

/** Khoảng id của lô kế tiếp khi chép từ `next` trở xuống: [low, next]. Hàm thuần. */
export function nextBackfillRange(next: number, batch = BACKFILL_BATCH_IDS): { low: number; high: number } {
  return { low: Math.max(1, next - batch + 1), high: next };
}

/**
 * Chép tin cũ vào bảng tìm, từ mốc đã lưu trở xuống, tới khi hết tin hoặc hết `budgetMs`. Lần đầu bắt đầu từ id lớn nhất
 * LÚC ĐÓ (tin mới hơn đã được indexMessage ghi — chạy sau khi mã mới đã chạy nên không lọt tin nào). Trả số tin đã chép.
 * INSERT IGNORE: tin đã có (vừa được ghi lẻ) giữ nguyên. Chạy song song với thu hồi vẫn đúng: INSERT … SELECT khóa đọc các
 * dòng nguồn, lệnh thu hồi chờ lô xong rồi mới xóa dòng tìm.
 */
export async function backfillMessageSearch(db: Db, budgetMs = BACKFILL_BUDGET_MS): Promise<number> {
  const started = Date.now();
  const [meta] = await db.query<RowDataPacket[]>("SELECT backfill_next_id FROM search_index_meta WHERE name = ?", [META_NAME]);
  if (!meta[0]) return 0;
  const saveProgress = (next: number) => db.query(
    "UPDATE search_index_meta SET backfill_next_id = ?, backfilled_at = IF(? = 0, CURRENT_TIMESTAMP(3), NULL) WHERE name = ?",
    [next, next, META_NAME]);
  let next: number;
  if (meta[0].backfill_next_id === null) {
    const [max] = await db.query<RowDataPacket[]>("SELECT COALESCE(MAX(id), 0) AS id FROM message");
    next = Number(max[0].id);
    // Kho chưa có tin nào: ghi «xong» luôn, không thì màn tìm báo «đang dựng chỉ mục» mãi
    if (next <= 0) await saveProgress(0);
  } else {
    next = Number(meta[0].backfill_next_id);
  }
  if (next <= 0) return 0;
  let copied = 0;
  while (next > 0 && Date.now() - started < budgetMs) {
    const { low, high } = nextBackfillRange(next);
    const [result] = await db.query<ResultSetHeader>(
      `INSERT IGNORE INTO message_search (message_id, group_id, sent_at, text) ${COPY_SELECT}
       WHERE m.id BETWEEN ? AND ? AND ${SEARCHABLE}`,
      [low, high]);
    copied += result.affectedRows;
    next = low - 1;
    await saveProgress(next);
    if (next > 0) await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAUSE_MS));
  }
  if (next === 0) log.info("đã chép xong tin cũ vào bảng tìm");
  return copied;
}

let cachedCoverage: { value: Date | null; until: number } | null = null;

/**
 * Tin cũ còn đang chép: mốc giờ gửi mà từ đó trở đi chắc đã tìm được (tin ngay trên mốc chép, id gần như theo thời gian).
 * null = đã chép đủ (hoặc không đọc được — không báo bừa). Nhớ 1 phút.
 */
export async function loadIndexedFrom(db: Db): Promise<Date | null> {
  if (cachedCoverage && cachedCoverage.until > Date.now()) return cachedCoverage.value;
  let value: Date | null = null;
  try {
    const [meta] = await db.query<RowDataPacket[]>(
      "SELECT backfill_next_id, built_at FROM search_index_meta WHERE name = ?", [META_NAME]);
    const row = meta[0];
    if (row && row.backfill_next_id === null) value = row.built_at as Date;
    else if (row && Number(row.backfill_next_id) > 0) {
      const [after] = await db.query<RowDataPacket[]>(
        "SELECT sent_at FROM message WHERE id > ? ORDER BY id LIMIT 1", [row.backfill_next_id]);
      value = (after[0]?.sent_at as Date | undefined) ?? (row.built_at as Date);
    }
  } catch (error) {
    log.warn("không đọc được tiến độ chép bảng tìm", error);
  }
  cachedCoverage = { value, until: Date.now() + COVERAGE_TTL_MS };
  return value;
}
