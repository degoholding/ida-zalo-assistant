import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { vnMidnight } from "../schedule/work-calendar.js";
import { computeFlags } from "./metric-flags.js";
import type { MetricRecord } from "./metric-types.js";

// Ghi bảng metric_value: upsert theo khóa duy nhất, dọn dòng đã biến mất khỏi bảng nguồn, tính lại cờ.

const BATCH = 500;
/** Chặn xóa khi lượt này đọc ra ít hơn ngần này tỉ lệ so với lượt trước (nghi tab sai / bảng bị xóa nhầm). */
export const VANISH_GUARD_RATIO = 0.5;

/**
 * `firstRun` = lượt thành công đầu tiên của nguồn: dòng của ngày đã qua đặt first_seen_at = 00:00 ngày số liệu (nhập lịch sử
 * không bị tính «báo muộn»). Ngày hôm nay (`todayIso`) vẫn lấy giờ lượt.
 */
export async function upsertRecords(db: Db, sourceId: number, records: MetricRecord[], runAt: Date, firstRun: boolean, todayIso: string): Promise<void> {
  for (let start = 0; start < records.length; start += BATCH) {
    const chunk = records.slice(start, start + BATCH);
    const params: unknown[] = [];
    for (const r of chunk) {
      const firstSeen = firstRun && r.date < todayIso ? vnMidnight(r.date) : runAt;
      params.push(sourceId, r.date, r.staffKey, r.staffName, r.catalogEntryId, r.areaKey, r.areaName, r.code, r.value, r.raw, r.baseFlags, r.row, firstSeen, runAt);
    }
    const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    await db.query(
      `INSERT INTO metric_value (source_id, metric_date, staff_key, staff_name, catalog_entry_id, area_key, area_name, metric_code,
         value, raw_text, flags, sheet_row, first_seen_at, seen_at) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE value = VALUES(value), raw_text = VALUES(raw_text), staff_name = VALUES(staff_name),
         area_name = VALUES(area_name), catalog_entry_id = VALUES(catalog_entry_id), sheet_row = VALUES(sheet_row), seen_at = VALUES(seen_at),
         flags = (flags & ~12) | (VALUES(flags) & 12)`,
      params,
    );
  }
}

export function shouldBlockRemoval(currentCount: number, previousCount: number): boolean {
  if (currentCount === 0) return true;
  return previousCount > 0 && currentCount < previousCount * VANISH_GUARD_RATIO;
}

export interface RemovalResult {
  removed: number;
  /** true = nghi bảng bị xóa nhầm → giữ số cũ */
  blocked: boolean;
}

/** Sau lượt THÀNH CÔNG: xóa dòng trong cửa sổ mà lượt này không còn thấy (seen_at < giờ lượt). */
export async function removeVanished(db: Db, sourceId: number, windowFrom: string, runAt: Date, currentCount: number, previousCount: number): Promise<RemovalResult> {
  if (shouldBlockRemoval(currentCount, previousCount)) return { removed: 0, blocked: true };
  const [result] = await db.query<ResultSetHeader>(
    "DELETE FROM metric_value WHERE source_id = ? AND metric_date >= ? AND seen_at < ?",
    [sourceId, windowFrom, runAt],
  );
  return { removed: result.affectedRows, blocked: false };
}

/** Tính lại Negative / Deviation cho cả cửa sổ; chỉ UPDATE dòng đổi cờ. Trả số dòng đổi. */
export async function applyFlags(db: Db, sourceId: number, windowFrom: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, staff_key, area_key, metric_code, DATE_FORMAT(metric_date, '%Y-%m-%d') AS d, value, flags
     FROM metric_value WHERE source_id = ? AND metric_date >= ?`,
    [sourceId, windowFrom],
  );
  const flags = computeFlags(rows.map((row) => ({
    id: Number(row.id),
    groupKey: `${row.staff_key}\u0000${row.area_key}\u0000${row.metric_code}`,
    date: String(row.d),
    value: row.value === null ? null : Number(row.value),
    // Chỉ giữ bit Unparsed (4) và UnknownStaff (8) làm gốc; Negative / Deviation tính lại
    baseFlags: Number(row.flags) & 12,
  })));
  let changed = 0;
  for (const row of rows) {
    const next = flags.get(Number(row.id)) ?? 0;
    if (next === Number(row.flags)) continue;
    await db.query("UPDATE metric_value SET flags = ? WHERE id = ?", [next, row.id]);
    changed += 1;
  }
  return changed;
}
