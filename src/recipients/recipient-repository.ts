import type { RowDataPacket } from "mysql2";
import { JobKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { enqueueJob } from "../jobs/job-queue.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";

// Người nhận cảnh báo / bản tin (phase 4, IDA câu 1: Trưởng phòng, CEO, trưởng nhóm cùng nhận, theo thứ tự ưu tiên).
// Kênh báo = chat riêng giữa người nhận và tài khoản bot trên Zalo. Tiến trình nào cũng gửi được: ghi việc
// RecipientMessage vào hàng đợi, tiến trình app (giữ phiên Zalo) gửi đi.

export interface RecipientRow {
  id: number;
  tenant_id: number;
  contact_id: number;
  zalo_uid: string;
  name: string;
  title: string;
  rank_order: number;
  all_groups: number;
  morning_brief_at: string;
  evening_brief_at: string;
  notify_urgent: number;
  is_active: number;
}

const RECIPIENT_COLUMNS = `r.id, r.tenant_id, r.contact_id, c.zalo_uid, r.name, r.title, r.rank_order, r.all_groups,
  r.morning_brief_at, r.evening_brief_at, r.notify_urgent, r.is_active`;

/** Người nhận đang bật, theo thứ tự ưu tiên. */
export async function listActiveRecipients(db: Db, tenantId = 1): Promise<RecipientRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${RECIPIENT_COLUMNS} FROM recipient r JOIN contact c ON c.id = r.contact_id
     WHERE r.tenant_id = ? AND r.is_active = 1 ORDER BY r.rank_order, r.id`, [tenantId]);
  return rows as RecipientRow[];
}

export async function findRecipient(db: Db, recipientId: number): Promise<RecipientRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${RECIPIENT_COLUMNS} FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE r.id = ?`, [recipientId]);
  return (rows[0] as RecipientRow | undefined) ?? null;
}

/** Người đang nhắn riêng cho bot có phải người nhận (đang bật) không — người nhận luôn được bot trả lời. */
export async function isActiveRecipientUid(db: Db, zaloUid: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE c.zalo_uid = ? AND r.is_active = 1 LIMIT 1", [zaloUid]);
  return rows.length > 0;
}

/** Nhóm một người nhận theo dõi; null = mọi nhóm đang đọc. */
export async function recipientGroupIds(db: Db, recipient: Pick<RecipientRow, "id" | "all_groups">): Promise<number[] | null> {
  if (recipient.all_groups) return null;
  const [rows] = await db.query<RowDataPacket[]>("SELECT group_id FROM recipient_group WHERE recipient_id = ?", [recipient.id]);
  return rows.map((row) => Number(row.group_id));
}

export interface RecipientMessagePayload {
  recipientId: number;
  /** Chữ bản tin / tóm tắt báo cáo — báo cáo tuần / tháng gửi KÈM `reportFiles` trong CÙNG job (review phase 8, M2+M3). */
  text?: string;
  /** Tệp đính kèm (PDF + Excel, phase 3) — `runner.sendDirectReportFile` gửi vào cuộc riêng, tuần tự sau chữ. */
  reportFiles?: GeneratedReportFile[];
  /** Có thì sau khi gửi xong (chữ + MỌI tệp) đánh dấu dòng `brief_log` tương ứng là `Sent` (phase 8, bản tin / báo cáo). */
  briefLogId?: number;
  /** Tiến độ đã gửi của CHÍNH job này — `sendRecipientMessage` (sync-service.ts) tự ghi lại sau mỗi phần thành công để
   * thử lại (lỗi giữa chừng) không gửi lặp phần đã xong (review phase 8, M2). */
  textSent?: boolean;
  /** Số tệp ĐẦU của `reportFiles` đã gửi xong — thử lại tiếp tục từ chỉ số này. */
  sentFileCount?: number;
}

/**
 * Xếp một tin riêng (hoặc một tệp báo cáo) cho người nhận vào hàng đợi (tiến trình app gửi). `dedupeKey` để một cảnh
 * báo / một phần của báo cáo không gửi hai lần. `expiresInMs` mặc định 2 giờ (cảnh báo / bản tin — trễ thì bỏ, đã vào
 * bản tin kế tiếp); báo cáo tuần / tháng gọi với 12 giờ (không cần gấp như cảnh báo, xem phase-03).
 */
export function enqueueRecipientMessage(
  db: Db, payload: RecipientMessagePayload, dedupeKey?: string, expiresInMs = 2 * 60 * 60_000,
): Promise<number | null> {
  return enqueueJob(db, {
    kind: JobKind.RecipientMessage, payload, dedupeKey, serialKey: `recipient:${payload.recipientId}`,
    expiresInMs, maxAttempts: 3,
  });
}
