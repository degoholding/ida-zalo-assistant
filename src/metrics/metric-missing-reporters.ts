import type { RowDataPacket } from "mysql2";
import { CatalogKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { vnMidnight } from "../schedule/work-calendar.js";

// «Chưa báo» / «báo muộn» — TÍNH KHI XEM, không lưu bảng riêng. Chỉ nguồn đánh dấu «báo hằng ngày» (IDA câu 15).
// Mốc: ngày D lúc 18:00 (`ready`); báo muộn = lần đầu bot thấy dòng của ngày D sau 18:15 (18:00 + 15 phút cho lượt chốt đọc xong).

const HOUR_MS = 3_600_000;
export const REPORT_DEADLINE_HOUR = 18;
export const REPORT_GRACE_MINUTES = 15;

export interface ReporterRef {
  id: number;
  code: string;
  name: string;
  region: string;
}

export interface MissingReporters {
  /** now ≥ D 18:00 và có ít nhất một nguồn «báo hằng ngày» đang bật — chưa tới thì không kết luận gì */
  ready: boolean;
  missing: ReporterRef[];
  late: ReporterRef[];
}

/** `date` = ngày số liệu «YYYY-MM-DD» (nơi gọi lo chỉ hỏi ngày làm việc). */
export async function listMissingReporters(db: Db, date: string, now: Date = new Date()): Promise<MissingReporters> {
  const dayStart = vnMidnight(date).getTime();
  const deadline = new Date(dayStart + REPORT_DEADLINE_HOUR * HOUR_MS);
  const cutoff = new Date(deadline.getTime() + REPORT_GRACE_MINUTES * 60_000);
  const [sources] = await db.query<RowDataPacket[]>("SELECT id FROM metric_source WHERE is_active = 1 AND daily_report = 1");
  if (sources.length === 0 || now < deadline) return { ready: false, missing: [], late: [] };
  const [staff] = await db.query<RowDataPacket[]>(
    "SELECT id, code, name, region FROM catalog_entry WHERE kind = ? AND is_active = 1 AND expects_report = 1 ORDER BY name",
    [CatalogKind.Staff],
  );
  const [seen] = await db.query<RowDataPacket[]>(
    `SELECT catalog_entry_id, MIN(first_seen_at) AS first_seen FROM metric_value
     WHERE source_id IN (?) AND metric_date = ? AND catalog_entry_id IS NOT NULL GROUP BY catalog_entry_id`,
    [sources.map((row) => Number(row.id)), date],
  );
  const firstSeen = new Map(seen.map((row) => [Number(row.catalog_entry_id), new Date(row.first_seen as Date)]));
  const missing: ReporterRef[] = [];
  const late: ReporterRef[] = [];
  for (const row of staff) {
    const ref = { id: Number(row.id), code: String(row.code), name: String(row.name), region: String(row.region ?? "") };
    const first = firstSeen.get(ref.id);
    if (!first) missing.push(ref);
    else if (first >= cutoff) late.push(ref);
  }
  return { ready: true, missing, late };
}
